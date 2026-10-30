package ar.com.josemascherpa.cinetv.remote;

/**
 * Un pedido del control remoto, ya traducido del protocolo del celular a algo propio.
 * Es el equivalente de src/domain/remote.ts en la versión de notebook.
 */
public final class RemoteCommand {

    public enum Kind { KEY, TEXT, OPEN_URL, POINTER_MOVE, POINTER_CLICK }

    public final Kind kind;
    /** POWER, HOME, BACK, MENU, UP, DOWN, LEFT, RIGHT, OK, VOLUME_UP… (como en la notebook). */
    public final String key;
    public final String text;
    public final String url;
    public final int dx;
    public final int dy;

    private RemoteCommand(Kind kind, String key, String text, String url, int dx, int dy) {
        this.kind = kind;
        this.key = key;
        this.text = text;
        this.url = url;
        this.dx = dx;
        this.dy = dy;
    }

    public static RemoteCommand key(String key) {
        return new RemoteCommand(Kind.KEY, key, null, null, 0, 0);
    }

    public static RemoteCommand text(String text) {
        return new RemoteCommand(Kind.TEXT, null, text, null, 0, 0);
    }

    public static RemoteCommand openUrl(String url) {
        return new RemoteCommand(Kind.OPEN_URL, null, null, url, 0, 0);
    }

    public static RemoteCommand pointerMove(int dx, int dy) {
        return new RemoteCommand(Kind.POINTER_MOVE, null, null, null, dx, dy);
    }

    public static RemoteCommand pointerClick() {
        return new RemoteCommand(Kind.POINTER_CLICK, null, null, null, 0, 0);
    }
}
