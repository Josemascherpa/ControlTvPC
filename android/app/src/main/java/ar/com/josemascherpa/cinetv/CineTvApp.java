package ar.com.josemascherpa.cinetv;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import ar.com.josemascherpa.cinetv.remote.RemoteCommand;
import ar.com.josemascherpa.cinetv.remote.RemoteHandler;
import ar.com.josemascherpa.cinetv.remote.TvVolume;
import ar.com.josemascherpa.cinetv.screen.Screen;
import ar.com.josemascherpa.cinetv.server.Assets;
import ar.com.josemascherpa.cinetv.server.PhoneLedger;
import ar.com.josemascherpa.cinetv.server.TvServer;

/**
 * Raíz de composición de la app: crea las piezas una sola vez (servidor, control y volumen) y las
 * conecta entre sí. Es el equivalente de src/app.ts en la versión de notebook.
 *
 * El servidor vive acá y no en la Activity: si la tele queda en segundo plano, el celular la sigue
 * encontrando y, al mandar un botón, la app vuelve al frente como si fuera el control de una tele.
 */
public final class CineTvApp extends Application {

    private static final String TAG = "CineTV";
    private static final String PREFS = "cine_tv";
    private static final String KEY_DEVICE_ID = "device_id";

    private final CountDownLatch ready = new CountDownLatch(1);
    private volatile int port;
    private volatile MainActivity screen;
    private volatile boolean paused;
    private RemoteHandler handler;

    @Override
    public void onCreate() {
        super.onCreate();

        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String deviceId = prefs.getString(KEY_DEVICE_ID, null);
        if (deviceId == null) {
            deviceId = "uuid:" + UUID.randomUUID();
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
        }

        TvVolume volume = new TvVolume((AudioManager) getSystemService(Context.AUDIO_SERVICE));
        volume.setReporter((level, muted) -> {
            MainActivity target = screen;
            if (target != null) target.showVolume(level, muted);
        });
        handler = new RemoteHandler(this::currentScreen, volume);

        TvServer server = new TvServer(
            new Assets(getAssets()),
            new PhoneLedger(prefs),
            deviceId,
            this::deviceName,
            new TvServer.Listener() {
                @Override
                public void onCommand(RemoteCommand command) {
                    bringToFront();
                    try {
                        handler.handle(command);
                    } catch (RuntimeException e) {
                        // Un error en una orden no tiene que cortar la conexión del celular.
                        Log.w(TAG, "No se pudo ejecutar " + command.kind + ": " + e);
                    }
                }

                @Override
                public void onShow() {
                    bringToFront();
                }

                @Override
                public void onPhoneConnected(String name) {
                    bringToFront();
                    MainActivity target = screen;
                    if (target != null) target.toast("Celular conectado", "📱");
                }

                @Override
                public void onPhoneRejected() {
                    MainActivity target = screen;
                    if (target != null) target.toast("Un celular nuevo quiere conectarse", "🔒");
                }
            });

        Thread starter = new Thread(() -> {
            port = server.start();
            ready.countDown();
        }, "cine-tv-start");
        starter.setDaemon(true);
        starter.start();
    }

    /** El puerto donde escucha el servidor (8001 salvo que esté ocupado). */
    public int awaitPort() {
        try {
            ready.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return port;
    }

    void attach(MainActivity activity) {
        screen = activity;
    }

    void detach(MainActivity activity) {
        if (screen == activity) screen = null;
    }

    void setPaused(boolean value) {
        paused = value;
    }

    private Screen currentScreen() {
        return screen;
    }

    /** Trae el Cine al frente: el celular "prende" la tele con cualquier botón. */
    private void bringToFront() {
        MainActivity target = screen;
        if (target != null && !paused) return;
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(intent);
        } catch (RuntimeException e) {
            Log.w(TAG, "No se pudo traer el Cine al frente: " + e);
        }
    }

    /** El nombre que ve el celular en la lista de teles: "Cine TV (Chromecast)", "Cine TV (AFTMM)"… */
    private String deviceName() {
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        if (model.isEmpty()) return "Cine TV";
        String name = "Cine TV (" + model + ")";
        return name.length() > 40 ? name.substring(0, 40) : name;
    }
}
