package ar.com.josemascherpa.cinetv.server;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Los archivos del Cine que viajan adentro del APK (la carpeta ui/ del repo). */
public final class Assets {

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("mjs", "text/javascript; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("map", "application/json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("txt", "text/plain; charset=utf-8");
    }

    private final AssetManager manager;

    public Assets(AssetManager manager) {
        this.manager = manager;
    }

    /** El contenido del archivo, o null si no existe. */
    public byte[] read(String path) {
        if (path.isEmpty() || path.contains("..")) return null;
        try (InputStream in = manager.open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(in.available(), 1024));
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    public static String mime(String path) {
        int dot = path.lastIndexOf('.');
        String extension = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String type = MIME.get(extension);
        return type == null ? "application/octet-stream" : type;
    }
}
