// Raíz de composición: el ÚNICO lugar que conoce las clases concretas. Crea cada pieza y le pasa
// sus dependencias por el constructor (inyección de dependencias a mano, como el AppContainer de
// la app Android). Todo lo demás depende sólo de interfaces (la "D" de SOLID).

import { join } from 'path';
import { HOME_URL, PATHS, PORTS } from './config/paths';
import { PhoneAccess } from './application/phone-access';
import { IdlePowerService } from './application/idle-power-service';
import { PhoneSessions } from './application/phone-sessions';
import { PointerService } from './application/pointer-service';
import { PowerService } from './application/power-service';
import { RemoteCommandHandler } from './application/remote-command-handler';
import { UiCommandHandler } from './application/ui-command-handler';
import { UiStateService } from './application/ui-state';
import { VolumeService } from './application/volume-service';
import { EdgeConnection } from './infrastructure/edge/edge-connection';
import { EdgeMedia } from './infrastructure/edge/edge-media';
import { EdgeOverlay } from './infrastructure/edge/edge-overlay';
import { EdgeScreen } from './infrastructure/edge/edge-screen';
import { AppIcons } from './infrastructure/home/app-icons';
import { BingBackgrounds } from './infrastructure/home/bing-backgrounds';
import { HomeDataService } from './infrastructure/home/home-data-service';
import { DolarApiProvider, GoogleNewsProvider, IpLocationProvider, OpenMeteoProvider } from './infrastructure/home/providers';
import { TvServer } from './infrastructure/http/tv-server';
import { LgTvClient } from './infrastructure/lg/lg-tv-client';
import { LgTvVolume } from './infrastructure/lg/lg-tv-volume';
import { HdmiTvPower } from './infrastructure/tv/hdmi-tv-power';
import { FileLogger } from './infrastructure/log/file-logger';
import { AppCatalogFile } from './infrastructure/storage/app-catalog-file';
import { SettingsFile } from './infrastructure/storage/settings-file';
import { HdmiVolume } from './infrastructure/windows/hdmi-volume';
import { InputHost, NativeInputLock, NativePointer } from './infrastructure/windows/input-host';
import { boostProcesses } from './infrastructure/windows/process-priority';
import { SystemActivity } from './infrastructure/windows/system-activity';
import { WindowsPowerPlans } from './infrastructure/windows/windows-power-plans';
import { OsNetwork } from './infrastructure/windows/os-network';
import { WindowsDisplay, WindowsMediaKeys } from './infrastructure/windows/windows-display';
import { SM, win32 } from './infrastructure/windows/win32';

async function main(): Promise<void> {
  // ---- Infraestructura ----
  const log = new FileLogger(PATHS.logs);
  const settings = new SettingsFile(PATHS.settings);
  const apps = new AppCatalogFile(PATHS.customApps, PATHS.appsExample);
  const network = new OsNetwork();
  const display = new WindowsDisplay();
  const inputHost = new InputHost(PATHS.nativeScripts, log);
  // CONTROLTV_TEST=1 → modo prueba: sin "siempre al frente" ni mouse bloqueado.
  const mouseLock = new NativeInputLock(inputHost, log, !process.env['CONTROLTV_TEST']);
  const hdmiVolume = new HdmiVolume(inputHost); // el volumen lo hace el mismo ayudante nativo
  const edge = new EdgeConnection({
    port: PORTS.devtools,
    profileDir: PATHS.edgeProfile,
    homeUrl: HOME_URL,
    injectScript: PATHS.injectScript,
    headless: Boolean(process.env['CONTROLTV_HEADLESS']),
    gpu: () => settings.get('gpu'),
  }, log);
  edge.browserProcess.subscribe((pid) => { inputHost.setTvProcess(pid); });
  edge.renderProcesses.subscribe((pids) => { boostProcesses(pids, log); });
  const screen = new EdgeScreen(edge, apps, HOME_URL, log);
  const overlay = new EdgeOverlay(edge);
  const pointerSurface = new NativePointer(inputHost);
  const home = new HomeDataService({
    location: new IpLocationProvider(),
    weather: new OpenMeteoProvider(),
    dollar: new DolarApiProvider(),
    news: new GoogleNewsProvider(),
    // Fondos al tamaño real de la pantalla (píxeles físicos, no los escalados de Windows).
    backgrounds: new BingBackgrounds(PATHS.backgrounds, join(PATHS.nativeScripts, 'resize-image.ps1'), {
      width: win32.getSystemMetrics(SM.CXSCREEN),
      height: win32.getSystemMetrics(SM.CYSCREEN),
    }),
  }, settings, PATHS.homeCache, log);
  const icons = new AppIcons(PATHS.icons, PATHS.bundledIcons, apps);

  // ---- Casos de uso ----
  const access = new PhoneAccess(settings);
  // Volumen: el del tele LG por WiFi; si todavía no está, el del sonido que sale por el HDMI.
  const lgClient = new LgTvClient(settings, log);
  const tvVolume = new LgTvVolume(lgClient, hdmiVolume, settings, network, overlay, log);
  // El tele del HDMI (cualquier marca): su MAC para prenderlo por la red y pasársela al celular.
  const hdmiTv = new HdmiTvPower(lgClient, () => tvVolume.connectKnown(), settings, network, log);
  const power = new PowerService(display, screen, mouseLock, settings, log, hdmiTv);
  const volume = new VolumeService(tvVolume, overlay);
  const pointer = new PointerService(pointerSurface, settings, log);
  const sessions = new PhoneSessions(access, power, overlay, log);
  const media = new EdgeMedia(edge);
  const idlePower = new IdlePowerService(new WindowsPowerPlans(), new SystemActivity(() => media.isPlaying(), () => inputHost.audioPeak()), power, settings, log);

  // El servidor recibe funciones (no los objetos) para lo que se arma después: así no hay
  // dependencias circulares entre el servidor y quien le publica avisos.
  let uiState: UiStateService | null = null;
  let remote: RemoteCommandHandler | null = null;
  let uiCommands: UiCommandHandler | null = null;
  const server = new TvServer({
    port: PORTS.server,
    uiDir: PATHS.ui,
    backgroundsDir: PATHS.backgrounds,
    deviceName: () => settings.get('name'),
    localAddress: () => network.localAddress(),
    hdmiTv: () => ({ mac: hdmiTv.mac, standby: hdmiTv.mac !== null && !hdmiTv.isOn }),
    phones: sessions,
    onRemoteCommand: (command) => remote?.handle(command) ?? Promise.resolve(),
    onUiCommand: (command) => uiCommands?.handle(command) ?? Promise.resolve(),
    uiState: () => uiState?.current() ?? fallbackState(settings.get('name')),
    home: () => home.snapshot(),
    apps: () => apps.list().map(({ id, name, category, color, background }) => ({ id, name, category, color, background })),
    iconPath: (appId) => icons.pathFor(appId),
    log,
  });
  uiState = new UiStateService(settings, network, access, sessions, volume, server, apps);
  remote = new RemoteCommandHandler(screen, pointer, volume, power, new WindowsMediaKeys(), server);
  uiCommands = new UiCommandHandler(screen, apps, access, power, mouseLock, uiState, settings);

  // ---- Arranque ----
  await server.listen();
  edge.start();
  home.start();
  tvVolume.start();
  hdmiTv.start();
  // Cuando se conecta un celular, se vuelve a buscar el tele (por si cambió): el celular lee su MAC.
  sessions.changed.subscribe(() => { hdmiTv.locateSoon(); });
  uiState.publishSoon();
  idlePower.start().catch((error: unknown) => {
    log.warn('Planes de energía:', error);
  });
  mouseLock.lock();
  volume.refresh().catch((error: unknown) => {
    log.warn('Volumen:', error);
  });

  process.on('unhandledRejection', (error) => {
    log.error('Promesa sin atrapar:', error);
  });
  process.on('uncaughtException', (error) => {
    log.error('Error inesperado:', error);
    process.exit(1); // main.ts nos vuelve a arrancar
  });
}

function fallbackState(name: string): Contracts.UiState {
  return { name, ip: null, phones: [], pairedCount: 0, allowNewPhones: true, volume: null, ambientMinutes: 3, homeApps: [], gpu: 'integrated', tv: null };
}

main().catch((error: unknown) => {
  console.error('No se pudo arrancar ControlTv:', error);
  process.exit(1);
});
