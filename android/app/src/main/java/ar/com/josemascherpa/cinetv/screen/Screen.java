package ar.com.josemascherpa.cinetv.screen;

/**
 * La pantalla de la tele: lo que el control remoto (el mando o el celular) le puede pedir.
 * La implementa MainActivity; el resto de la app no sabe que atrás hay un WebView.
 */
public interface Screen {

    /** Una tecla de navegación, ya con el nombre que entiende una página: ArrowUp, Enter, PageUp… */
    void key(String pageKey);

    /** Atrás: cierra el reproductor, la ficha o la búsqueda. Si no hay nada abierto, sale de la app. */
    void back();

    /** Inicio / Menú: vuelve al principio del catálogo. */
    void home();

    /** Texto que manda el celular ("Escribir en la TV"): va al buscador del Cine. */
    void text(String text);

    /** Búsqueda que manda el celular ("Buscar"): busca dentro del Cine. */
    void search(String query);

    /** Play/pausa del control. */
    void togglePlayback();

    /** Corta el sonido del video (para el botón de apagar la imagen). */
    void pausePlayback();

    void cursorMove(int dx, int dy);

    void cursorClick();

    /** Prender / apagar la imagen (el botón de encendido del celular). */
    void togglePower();

    /** La imagen está apagada (pantalla en negro, como el "apagar la imagen" de la notebook). */
    boolean isPictureOff();

    /** Vuelve a mostrar la imagen (cualquier botón la prende). */
    void wakePicture();

    /** La barrita de volumen que dibuja el Cine. */
    void showVolume(int level, boolean muted);

    void toast(String text, String icon);
}
