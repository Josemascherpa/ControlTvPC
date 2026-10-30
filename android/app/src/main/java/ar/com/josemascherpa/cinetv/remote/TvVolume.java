package ar.com.josemascherpa.cinetv.remote;

import android.media.AudioManager;
import android.util.Log;

/**
 * Volumen de la tele. El celular manda KEY_VOLUP/KEY_VOLDOWN/KEY_MUTE igual que a una Samsung; acá
 * se cambia el volumen de la tele y se muestra la barrita del Cine (la misma que usa la notebook).
 */
public final class TvVolume {

    public interface Reporter {
        void report(int level, boolean muted);
    }

    private static final String TAG = "CineTV";

    private final AudioManager audio;
    private volatile Reporter reporter;

    public TvVolume(AudioManager audio) {
        this.audio = audio;
    }

    public void setReporter(Reporter reporter) {
        this.reporter = reporter;
    }

    public void up() {
        adjust(AudioManager.ADJUST_RAISE);
    }

    public void down() {
        adjust(AudioManager.ADJUST_LOWER);
    }

    public void mute() {
        adjust(AudioManager.ADJUST_TOGGLE_MUTE);
    }

    /** Vuelve a mostrar la barrita con el volumen actual (por ejemplo, al conectar el celular). */
    public void report() {
        if (audio == null) return;
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        boolean muted = audio.isStreamMute(AudioManager.STREAM_MUSIC);
        int level = max <= 0 ? 0 : Math.round(current * 100f / max);
        Reporter target = reporter;
        if (target != null) target.report(level, muted);
    }

    private void adjust(int direction) {
        if (audio == null) return;
        try {
            // Sin cartel del sistema: la barrita la dibuja el Cine, como en la notebook.
            audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, 0);
        } catch (RuntimeException e) {
            Log.w(TAG, "No se pudo cambiar el volumen: " + e);
        }
        report();
    }
}
