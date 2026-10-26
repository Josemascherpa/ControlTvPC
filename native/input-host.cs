// ===== Ayudante nativo de ControlTv: ÃšNICA fuente del cÃ³digo =====
// Se compila UNA vez a input-host.exe (native/build-native.ps1, lo corre "npm run build" e instalar.ps1).
// Si el .exe no estÃ¡, input-host.ps1 compila este mismo archivo al vuelo (mÃ¡s lento al arrancar).
//
// Ayudante nativo de entrada (C# compilado al vuelo, sin instalar nada). Queda abierto y recibe
// órdenes por la entrada estándar, una por línea:
//   move DX DY     mueve el cursor (en píxeles reales de la pantalla)
//   click          clic izquierdo donde está el cursor
//   wheel DY DX    desplazamiento (positivo = bajar / ir a la derecha), en "clics" de ruedita × 120
//   hide           esconde la flecha (se están usando las flechas del control)
//   lock|unlock    "modo tele": bloquea el mouse/touchpad físico y mantiene la tele siempre al frente
//                  (la única salida es "Salir al escritorio", que manda unlock)
//   tvpid N        el proceso de la ventana de la tele
//   vol get|up N|down N|mute   volumen del sonido que sale por el HDMI; contesta "nivel,silencio"
//
// Es el ÚNICO ayudante nativo (cursor, mouse, tele al frente y volumen en un solo proceso: menos memoria).
//
// Cómo logra que se vea fluido:
//   - La flecha es una ventanita transparente que compone Windows directamente (no depende de Edge).
//   - Se dibuja sincronizada con la pantalla (DwmFlush espera a cada cuadro: 60 por segundo exactos).
//   - Los movimientos que llegan por WiFi vienen a ráfagas: la flecha los sigue con un suavizado
//     que depende del tiempo real entre cuadros, así se desliza parejo en vez de saltar.
//   - El scroll también se reparte en pasitos chicos cuadro a cuadro (como un touchpad de verdad).
//   - Si no hay nada que mover, el hilo de dibujo duerme: no gasta nada.
// Si se cierra la entrada (ControlTv salió o se cayó), libera el mouse y termina.

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class CursorWindow : Form {
    // Capa con transparencia por píxel, atravesable, sin botón en la barra, nunca toma el foco.
    const int WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x8000000, WS_EX_TOPMOST = 0x8;
    protected override CreateParams CreateParams {
        get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST; return cp; }
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    public CursorWindow() {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
    }
}

// ---------- Volumen del sonido que sale por el HDMI (API de audio de Windows, sin cartel) ----------
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
}
// Medidor del nivel de lo que está sonando (para saber si hay una película o música reproduciéndose,
// venga de donde venga: también de los reproductores metidos en otra página).
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation { int GetPeakValue(out float pfPeak); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class TvAudio {
    // La salida por defecto se pide cada vez: si se desenchufa y enchufa el HDMI, sigue andando.
    static T Endpoint<T>() where T : class {
        var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        IMMDevice dev = null;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
        object instance = null;
        var id = typeof(T).GUID;
        Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out instance));
        return (T)instance;
    }
    static IAudioEndpointVolume Vol() { return Endpoint<IAudioEndpointVolume>(); }

    /** El nivel más alto que sonó recién (0 = silencio, 1 = al máximo), o -1 si no se pudo leer. */
    public static string Peak() {
        try {
            float peak;
            Marshal.ThrowExceptionForHR(Endpoint<IAudioMeterInformation>().GetPeakValue(out peak));
            return peak.ToString("0.0000", CultureInfo.InvariantCulture);
        } catch (Exception) {
            return "-1";
        }
    }
    static float Level {
        get { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
        set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, value)), Guid.Empty)); }
    }
    static bool Muted {
        get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
        set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
    }
    /** Ejecuta "get | up N | down N | mute" y devuelve "nivel,silencio" (ej. "45,0"), o "error". */
    public static string Run(string action, double amount) {
        try {
            switch (action) {
                case "up": Muted = false; Level = Level + (float)(amount / 100); break;
                case "down": Level = Level - (float)(amount / 100); break;
                case "mute": Muted = !Muted; break;
            }
            return string.Format(CultureInfo.InvariantCulture, "{0},{1}", (int)Math.Round(Level * 100), Muted ? 1 : 0);
        } catch (Exception) {
            return "error";
        }
    }
}

public static class InputHost {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLENDFUNCTION { public byte Op; public byte Flags; public byte Alpha; public byte Format; }
    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public int x; public int y; public uint data; public uint flags; public uint time; public IntPtr extra; }
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pprSrc, int crKey, ref BLENDFUNCTION pblend, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc fn, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc fn, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    const uint LEFTDOWN = 0x2, LEFTUP = 0x4, WHEEL = 0x800, HWHEEL = 0x1000;
    const double HIDE_AFTER_S = 4.0;
    const double FOLLOW_S = 0.016;   // qué tan rápido la flecha alcanza al dedo (menos = más pegada)
    const double SCROLL_S = 0.07;    // en cuánto tiempo se reparte un paso de scroll
    const double CLICK_S = 0.22;     // duración de la animación de clic

    static readonly object sync = new object();
    static readonly AutoResetEvent wake = new AutoResetEvent(false);
    static readonly Stopwatch clock = Stopwatch.StartNew();

    static CursorWindow window;
    static IntPtr windowHandle, screenDc, memDc, hBmp;
    static int screenW, screenH, size;
    // Estado (protegido por "sync"): posición deseada y la que se ve, opacidad, scroll pendiente.
    static double targetX, targetY, shownX, shownY, opacity, wantedOpacity, lastActivity;
    static double wheelY, wheelX, clickAge = 1;
    static IntPtr hook = IntPtr.Zero;
    static HookProc hookProc;            // referencias vivas: si el recolector las borra, Windows se cuelga
    static WinEventProc foregroundProc;
    static uint tvPid;
    static volatile bool tvInFront = true;
    static volatile bool tvMode;         // "modo tele": mouse bloqueado y la tele siempre al frente
    static readonly object outputSync = new object();

    static double Now() { return clock.Elapsed.TotalSeconds; }

    public static void Run() {
        SetProcessDPIAware(); // coordenadas reales (la tele puede estar escalada)
        // Sin timeBeginPeriod(1): el ritmo lo marca DwmFlush (un cuadro de pantalla), y subir la
        // precisión del reloj de Windows todo el tiempo gasta energía en todo el sistema.
        screenW = GetSystemMetrics(0);
        screenH = GetSystemMetrics(1);
        size = Math.Max(36, screenH / 18);
        targetX = shownX = screenW / 2.0;
        targetY = shownY = screenH / 2.0;

        window = new CursorWindow();
        window.Width = size; window.Height = size;
        window.Load += (s, e) => {
            windowHandle = window.Handle;
            screenDc = GetDC(IntPtr.Zero);
            memDc = CreateCompatibleDC(screenDc);
            DrawArrow(1.0);
            new Thread(RenderLoop) { IsBackground = true, Priority = ThreadPriority.AboveNormal }.Start();
        };
        foregroundProc = (h, ev, hwnd, o, c, t, tm) => UpdateForeground();
        SetWinEventHook(3, 3, IntPtr.Zero, foregroundProc, 0, 0, 0); // EVENT_SYSTEM_FOREGROUND
        // Modo tele: si otra ventana pasó al frente (Alt+Tab, un programa que se abrió…), la tele
        // vuelve enseguida. Revisar un "sí/no" cada 0,4 s no gasta nada.
        var keepFront = new System.Windows.Forms.Timer { Interval = 400 };
        keepFront.Tick += (s, e) => { if (tvMode && tvPid != 0 && !tvInFront) BringTvToFront(); };
        keepFront.Start();
        new Thread(ReadCommands) { IsBackground = true }.Start();
        Application.Run(window);
        Unlock();
    }

    // ---------- Dibujo ----------

    // Dibuja la flecha a una escala dada (1 = normal; menos = "apretada" durante el clic).
    static void DrawArrow(double scale) {
        using (var bmp = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppPArgb))
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            float k = (float)(size / 32.0 * scale);
            var arrow = new PointF[] {
                new PointF(3*k, 2*k), new PointF(3*k, 24*k), new PointF(8.6f*k, 18.8f*k), new PointF(12.6f*k, 27.6f*k),
                new PointF(16.4f*k, 25.9f*k), new PointF(12.5f*k, 17.3f*k), new PointF(20.5f*k, 17.3f*k) };
            // Sombra suave: varias capas apenas desplazadas y transparentes.
            for (int i = 4; i >= 1; i--) {
                using (var shadow = new SolidBrush(Color.FromArgb(16, 0, 0, 0))) {
                    float d = i * 0.55f * k;
                    var off = Array.ConvertAll(arrow, p => new PointF(p.X + d * 0.5f, p.Y + d));
                    g.FillPolygon(shadow, off);
                }
            }
            using (var path = new GraphicsPath()) {
                path.AddPolygon(arrow);
                using (var fill = new LinearGradientBrush(new PointF(0, 2*k), new PointF(0, 28*k), Color.White, Color.FromArgb(255, 226, 232, 240)))
                    g.FillPath(fill, path);
                using (var pen = new Pen(Color.FromArgb(255, 20, 22, 28), 1.7f*k) { LineJoin = LineJoin.Round })
                    g.DrawPath(pen, path);
            }
            // Durante el clic, un anillo que se abre desde la punta.
            if (clickAge < 1) {
                float r = (float)(4 + clickAge * 9) * k / (float)scale;
                int a = (int)(170 * (1 - clickAge));
                using (var ring = new Pen(Color.FromArgb(a, 255, 255, 255), 1.6f * k))
                    g.DrawEllipse(ring, 3*k/(float)scale - r, 2*k/(float)scale - r, r * 2, r * 2);
            }
            IntPtr fresh = bmp.GetHbitmap(Color.FromArgb(0));
            SelectObject(memDc, fresh);
            if (hBmp != IntPtr.Zero) DeleteObject(hBmp);
            hBmp = fresh;
        }
    }

    static void Present(double x, double y, double alpha) {
        var dst = new POINT { X = (int)Math.Round(x - 3 * size / 32.0), Y = (int)Math.Round(y - 2 * size / 32.0) };
        var sz = new SIZE { cx = size, cy = size };
        var src = new POINT { X = 0, Y = 0 };
        var blend = new BLENDFUNCTION { Op = 0, Flags = 0, Alpha = (byte)Math.Max(0, Math.Min(255, Math.Round(255 * alpha))), Format = 1 };
        UpdateLayeredWindow(windowHandle, screenDc, ref dst, ref sz, memDc, ref src, 0, ref blend, 2);
    }

    // Un cuadro por cada refresco de pantalla mientras haya algo que mover; si no, duerme.
    static void RenderLoop() {
        double last = Now();
        while (true) {
            bool busy;
            lock (sync) busy = IsBusy();
            if (!busy) {
                // Dormido hasta la próxima orden; pero si la flecha está a la vista, como mucho hasta
                // que toque esconderla (si no, quedaría visible hasta que llegue otra orden).
                double hideIn;
                lock (sync) hideIn = wantedOpacity > 0 ? HIDE_AFTER_S - (Now() - lastActivity) : -1;
                if (hideIn < 0) wake.WaitOne();
                else wake.WaitOne(TimeSpan.FromSeconds(hideIn + 0.02));
                last = Now();
            }
            if (DwmFlush() != 0) Thread.Sleep(8); // espera al próximo cuadro de la pantalla
            double now = Now();
            double dt = Math.Min(0.05, now - last);
            last = now;
            Step(now, dt);
        }
    }

    static bool IsBusy() {
        return Math.Abs(targetX - shownX) > 0.2 || Math.Abs(targetY - shownY) > 0.2
            || Math.Abs(wantedOpacity - opacity) > 0.004 || Math.Abs(wheelY) >= 1 || Math.Abs(wheelX) >= 1
            || clickAge < 1 || (wantedOpacity > 0 && Now() - lastActivity > HIDE_AFTER_S);
    }

    static void Step(double now, double dt) {
        double x, y, alpha; int scrollY = 0, scrollX = 0; bool redraw = false; double pressScale = 1;
        lock (sync) {
            if (wantedOpacity > 0 && now - lastActivity > HIDE_AFTER_S) wantedOpacity = 0;
            // Suavizado exponencial según el tiempo real: igual de suave aunque un cuadro tarde más.
            double follow = 1 - Math.Exp(-dt / FOLLOW_S);
            shownX += (targetX - shownX) * follow;
            shownY += (targetY - shownY) * follow;
            double fade = 1 - Math.Exp(-dt / (wantedOpacity > opacity ? 0.05 : 0.12));
            opacity += (wantedOpacity - opacity) * fade;
            if (Math.Abs(wantedOpacity - opacity) < 0.004) opacity = wantedOpacity;
            // Scroll repartido en pasitos: Edge recibe un desplazamiento "de precisión", como un touchpad.
            double share = 1 - Math.Exp(-dt / SCROLL_S);
            double takeY = Math.Abs(wheelY) < 4 ? wheelY : wheelY * share;
            double takeX = Math.Abs(wheelX) < 4 ? wheelX : wheelX * share;
            scrollY = (int)Math.Round(takeY); scrollX = (int)Math.Round(takeX);
            wheelY -= scrollY; wheelX -= scrollX;
            if (clickAge < 1) {
                clickAge = Math.Min(1, clickAge + dt / CLICK_S);
                pressScale = 1 - 0.12 * Math.Sin(Math.PI * Math.Min(1, clickAge * 2));
                redraw = true;
            }
            x = shownX; y = shownY; alpha = opacity;
        }
        if (redraw) DrawArrow(pressScale);
        Present(x, y, alpha);
        // Windows: rueda positiva = subir, así que se invierte; la horizontal positiva = derecha.
        if (scrollY != 0) mouse_event(WHEEL, 0, 0, -scrollY, UIntPtr.Zero);
        if (scrollX != 0) mouse_event(HWHEEL, 0, 0, scrollX, UIntPtr.Zero);
    }

    // ---------- Órdenes ----------

    static void ReadCommands() {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
            var parts = line.Trim().Split(' ');
            if (parts[0] == "vol" || parts[0] == "peak") {
                // Órdenes con respuesta: una línea ("nivel,silencio" o el nivel de sonido), en el orden en que llegan.
                string answer = parts[0] == "peak" ? TvAudio.Peak() : TvAudio.Run(parts.Length > 1 ? parts[1] : "get", Arg(parts, 2));
                lock (outputSync) { Console.Out.WriteLine(answer); Console.Out.Flush(); }
                continue;
            }
            if (parts[0] == "lock" || parts[0] == "unlock" || parts[0] == "tvpid") {
                // Los "hooks" de Windows se manejan desde el hilo de la ventana.
                try { window.BeginInvoke((Action)(() => Execute(parts))); } catch (InvalidOperationException) { }
            } else {
                Execute(parts);
            }
            wake.Set();
        }
        try { window.BeginInvoke((Action)(() => Application.Exit())); } catch (InvalidOperationException) { Environment.Exit(0); }
    }

    static double Arg(string[] parts, int i) {
        double v;
        return parts.Length > i && double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;
    }

    static void Execute(string[] parts) {
        switch (parts[0]) {
            case "move": {
                int cx, cy;
                lock (sync) {
                    if (wantedOpacity == 0 && opacity < 0.05) { shownX = targetX; shownY = targetY; } // reaparece donde estaba
                    targetX = Math.Max(0, Math.Min(screenW - 1, targetX + Arg(parts, 1)));
                    targetY = Math.Max(0, Math.Min(screenH - 1, targetY + Arg(parts, 2)));
                    lastActivity = Now();
                    wantedOpacity = 1;
                    cx = (int)targetX; cy = (int)targetY;
                }
                SetCursorPos(cx, cy); // el cursor real va directo: pasar por encima y clics precisos
                break;
            }
            case "click": {
                int cx, cy;
                lock (sync) { cx = (int)targetX; cy = (int)targetY; lastActivity = Now(); wantedOpacity = 1; clickAge = 0; }
                SetCursorPos(cx, cy);
                mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
                break;
            }
            case "wheel":
                lock (sync) { wheelY += Arg(parts, 1); wheelX += Arg(parts, 2); lastActivity = Now(); }
                break;
            case "hide": lock (sync) wantedOpacity = 0; break;
            case "lock": Lock(); break;
            case "unlock": Unlock(); break;
            case "tvpid": tvPid = (uint)Arg(parts, 1); UpdateForeground(); break;
        }
    }

    // ---------- Bloqueo del mouse físico ----------

    static void UpdateForeground() {
        if (tvPid == 0) { tvInFront = true; return; }
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        tvInFront = pid == tvPid;
    }

    // Modo tele: mouse físico bloqueado y la tele siempre al frente.
    static void Lock() {
        tvMode = true;
        if (tvPid != 0 && !tvInFront) BringTvToFront();
        if (hook != IntPtr.Zero) return;
        hookProc = OnMouse;
        hook = SetWindowsHookEx(14, hookProc, GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName), 0);
    }

    // "Salir al escritorio": se libera todo.
    static void Unlock() {
        tvMode = false;
        if (hook == IntPtr.Zero) return;
        UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
    }

    // Busca la ventana principal de la tele (la más grande con título de ese proceso) y la trae al
    // frente. Windows no deja que cualquiera robe el foco: tocar Alt antes lo habilita (truco conocido).
    static void BringTvToFront() {
        IntPtr best = IntPtr.Zero;
        EnumWindows((hwnd, l) => {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == tvPid && IsWindowVisible(hwnd) && GetWindowTextLength(hwnd) > 0 && best == IntPtr.Zero) best = hwnd;
            return true;
        }, IntPtr.Zero);
        if (best == IntPtr.Zero) return;
        if (IsIconic(best)) ShowWindow(best, 9); // SW_RESTORE: la que estaba minimizada vuelve
        keybd_event(0x12, 0, 0, UIntPtr.Zero);   // Alt apretado…
        keybd_event(0x12, 0, 2, UIntPtr.Zero);   // …y soltado
        SetForegroundWindow(best);
        BringWindowToTop(best);
        UpdateForeground();
    }

    // Mouse/touchpad físico con la tele al frente: se descarta. Lo que genera el sistema (nuestros
    // clics y scroll) pasa siempre, y si la persona está usando otra ventana también.
    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
        if (code >= 0) {
            var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            if ((info.flags & 1) == 0 && tvInFront) return (IntPtr)1;
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }
}

/// <summary>Punto de entrada del .exe compilado (el .ps1 de respaldo llama a InputHost.Run directamente).</summary>
public static class Program {
    [STAThread]
    public static void Main() { InputHost.Run(); }
}
