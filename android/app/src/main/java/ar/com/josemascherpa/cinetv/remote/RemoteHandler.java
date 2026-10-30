package ar.com.josemascherpa.cinetv.remote;

import android.net.Uri;

import java.net.URLDecoder;

import ar.com.josemascherpa.cinetv.screen.Screen;

/**
 * Ejecuta lo que pide el control remoto. No sabe nada del protocolo del celular ni del WebView:
 * sólo le habla a Screen. Es el equivalente de src/application/remote-command-handler.ts.
 */
public final class RemoteHandler {

    public interface ScreenProvider {
        Screen get();
    }

    private final ScreenProvider screens;
    private final TvVolume volume;

    public RemoteHandler(ScreenProvider screens, TvVolume volume) {
        this.screens = screens;
        this.volume = volume;
    }

    public void handle(RemoteCommand command) {
        Screen screen = screens.get();
        if (screen == null) return;
        // Con la imagen apagada, cualquier botón la prende (y no hace nada más), igual que la notebook.
        boolean power = command.kind == RemoteCommand.Kind.KEY && "POWER".equals(command.key);
        if (screen.isPictureOff() && !power) {
            screen.wakePicture();
            return;
        }
        switch (command.kind) {
            case KEY:
                handleKey(screen, command.key);
                break;
            case TEXT:
                screen.text(command.text);
                break;
            case OPEN_URL:
                openUrl(screen, command.url);
                break;
            case POINTER_MOVE:
                screen.cursorMove(command.dx, command.dy);
                break;
            case POINTER_CLICK:
                screen.cursorClick();
                break;
        }
    }

    private void handleKey(Screen screen, String key) {
        switch (key) {
            case "UP":
                screen.key("ArrowUp");
                break;
            case "DOWN":
                screen.key("ArrowDown");
                break;
            case "LEFT":
                screen.key("ArrowLeft");
                break;
            case "RIGHT":
                screen.key("ArrowRight");
                break;
            case "OK":
                screen.key("Enter");
                break;
            case "BACK":
                screen.back();
                break;
            // Sin inicio ni menú aparte: los dos vuelven al principio del Cine (igual que la notebook).
            case "HOME":
            case "MENU":
                screen.home();
                break;
            case "CHANNEL_UP":
                screen.key("PageUp");
                break;
            case "CHANNEL_DOWN":
                screen.key("PageDown");
                break;
            case "PLAY_PAUSE":
                screen.togglePlayback();
                break;
            case "VOLUME_UP":
                volume.up();
                break;
            case "VOLUME_DOWN":
                volume.down();
                break;
            case "MUTE":
                volume.mute();
                break;
            case "POWER":
                screen.togglePower();
                break;
            default:
                break;
        }
    }

    /** "Buscar" en el celular manda una búsqueda de Google: se busca en el Cine, no se abre el navegador. */
    private void openUrl(Screen screen, String url) {
        String query = googleSearchQuery(url);
        if (query == null) return;
        screen.search(query);
    }

    private static String googleSearchQuery(String url) {
        try {
            Uri parsed = Uri.parse(url);
            String host = parsed.getHost();
            if (host == null || !host.matches("(www\\.)?google\\.[a-z.]+")) return null;
            if (!"/search".equals(parsed.getPath())) return null;
            String query = parsed.getQueryParameter("q");
            if (query == null) return null;
            String decoded = URLDecoder.decode(query, "UTF-8").trim();
            return decoded.isEmpty() ? null : decoded;
        } catch (RuntimeException | java.io.UnsupportedEncodingException e) {
            return null;
        }
    }
}
