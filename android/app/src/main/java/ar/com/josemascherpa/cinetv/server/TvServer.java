package ar.com.josemascherpa.cinetv.server;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

import ar.com.josemascherpa.cinetv.remote.RemoteCommand;

/**
 * El servidor de la tele. Hace dos trabajos:
 *
 *  1. Para el celular se hace pasar por una Samsung: contesta /api/v2/ y abre el WebSocket
 *     samsung.remote.control en el puerto 8001 (el mismo que usa la notebook).
 *  2. Para la tele sirve los archivos del Cine en 127.0.0.1:8001, así el WebView los carga como una
 *     página web normal (módulos, IndexedDB y fetch funcionan; con file:// no andarían).
 *
 * Es el equivalente de src/infrastructure/http/tv-server.ts, sin la parte de Windows.
 */
public final class TvServer {

    private static final String TAG = "CineTV";
    public static final int DEFAULT_PORT = 8001;

    private static final int MAX_HEADER_BYTES = 16 * 1024;
    private static final int MAX_FRAME_BYTES = 256 * 1024;
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int OP_CONTINUATION = 0x0;
    private static final int OP_TEXT = 0x1;
    private static final int OP_CLOSE = 0x8;
    private static final int OP_PING = 0x9;
    private static final int OP_PONG = 0xA;

    /** Lo que el servidor necesita del resto de la app (lo implementa CineTvApp). */
    public interface Listener {
        void onCommand(RemoteCommand command);

        void onShow();

        void onPhoneConnected(String name);

        void onPhoneRejected();
    }

    private final Assets assets;
    private final PhoneLedger ledger;
    private final String deviceId;
    private final Supplier<String> deviceName;
    private final Listener listener;

    private volatile ServerSocket serverSocket;
    private volatile int port = DEFAULT_PORT;

    public TvServer(Assets assets, PhoneLedger ledger, String deviceId, Supplier<String> deviceName,
                    Listener listener) {
        this.assets = assets;
        this.ledger = ledger;
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.listener = listener;
    }

    /** Abre el puerto 8001. Si está ocupado, igual sirve el Cine en otro puerto. */
    public int start() {
        ServerSocket socket = bind(DEFAULT_PORT);
        if (socket == null) {
            Log.w(TAG, "El puerto " + DEFAULT_PORT + " está ocupado: el celular no va a encontrar la tele");
            socket = bind(0);
        }
        if (socket == null) {
            Log.e(TAG, "No se pudo abrir ningún puerto para el servidor");
            return 0;
        }
        serverSocket = socket;
        port = socket.getLocalPort();
        Thread thread = new Thread(this::acceptLoop, "cine-tv-server");
        thread.setDaemon(true);
        thread.start();
        Log.i(TAG, "Servidor escuchando en el puerto " + port);
        return port;
    }

    public int port() {
        return port;
    }

    private ServerSocket bind(int candidate) {
        try {
            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(candidate), 32);
            return socket;
        } catch (IOException e) {
            Log.w(TAG, "No se pudo abrir el puerto " + candidate + ": " + e.getMessage());
            return null;
        }
    }

    private void acceptLoop() {
        ServerSocket socket = serverSocket;
        while (socket != null && !socket.isClosed()) {
            try {
                Socket client = socket.accept();
                Thread worker = new Thread(() -> serve(client), "cine-tv-client");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException e) {
                if (!socket.isClosed()) Log.w(TAG, "Aceptar conexión: " + e.getMessage());
            }
        }
    }

    // ---------- HTTP ----------

    private void serve(Socket client) {
        try {
            client.setSoTimeout(30_000);
            client.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(client.getInputStream());
            OutputStream out = new BufferedOutputStream(client.getOutputStream());

            String requestLine = readLine(in);
            if (requestLine == null) return;
            Map<String, String> headers = readHeaders(in);
            String[] parts = requestLine.split(" ");
            if (parts.length < 3) return;
            String method = parts[0];
            String target = parts[1];

            boolean websocket = "websocket".equalsIgnoreCase(headers.get("upgrade"));
            if (websocket && SamsungProtocol.REMOTE_PATH.equals(pathOf(target))) {
                client.setSoTimeout(0);
                openRemote(in, out, target, headers);
            } else {
                respondHttp(client, method, target, out);
            }
        } catch (IOException e) {
            Log.d(TAG, "Conexión terminada: " + e.getMessage());
        } catch (RuntimeException e) {
            Log.w(TAG, "Conexión con error: " + e);
        } finally {
            try {
                client.close();
            } catch (IOException ignored) {
                // el celular ya se fue
            }
        }
    }

    private void respondHttp(Socket client, String method, String target, OutputStream out) throws IOException {
        String path = pathOf(target);

        // Lo que la app del celular pregunta para reconocer la tele (y para saber su nombre).
        if (SamsungProtocol.INFO_PATH.equals(path) || (SamsungProtocol.INFO_PATH + "/").equals(path)) {
            JSONObject info = SamsungProtocol.deviceInfo(deviceName.get(), Net.localIpv4(), port, deviceId);
            writeJson(out, 200, info);
            return;
        }

        // El acceso directo de la tele la trae al frente si ya estaba abierta.
        if ("/api/show".equals(path) && "POST".equalsIgnoreCase(method)) {
            listener.onShow();
            writeJson(out, 200, json("ok", true));
            return;
        }

        // Los archivos del Cine sólo se sirven a la propia tele (igual que en la notebook).
        if (!isLoopback(client)) {
            writeJson(out, 403, json("error", "sólo desde la tele"));
            return;
        }

        boolean index = "/".equals(path) || "/index.html".equals(path);
        String assetPath = index ? "index.html" : path.substring(1);
        byte[] body = assets.read(assetPath);
        if (body == null) {
            writeJson(out, 404, json("error", "no existe"));
            return;
        }
        if (index) body = indexWithScripts(body);
        writeFile(out, body, Assets.mime(assetPath));
    }

    /**
     * El Cine no sabe que corre en una tele: acá se le agregan, antes de su código, el cartel de
     * avisos/volumen (el mismo de la notebook) y las funciones que usa esta app (teclas, texto,
     * puntero). Así el Cine encuentra todo listo cuando arranca.
     */
    private static byte[] indexWithScripts(byte[] html) {
        String text = new String(html, StandardCharsets.UTF_8);
        int at = text.indexOf("</head>");
        if (at < 0) return html;
        String scripts = "  <script src=\"js/web/inject.js\"></script>\n"
            + "  <script src=\"js/web/tv/bridge.js\"></script>\n";
        return (text.substring(0, at) + scripts + text.substring(at)).getBytes(StandardCharsets.UTF_8);
    }

    private static boolean isLoopback(Socket client) {
        return client.getInetAddress().isLoopbackAddress();
    }

    // ---------- WebSocket (Samsung) ----------

    private void openRemote(InputStream in, OutputStream out, String target, Map<String, String> headers)
        throws IOException {
        String key = headers.get("sec-websocket-key");
        if (key == null) {
            writeResponse(out, 400, "text/plain; charset=utf-8", "WebSocket sin clave".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String head = "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.flush();

        String query = queryOf(target);
        String phone = SamsungProtocol.decodeClientName(param(query, "name"));
        String token = param(query, "token");
        String admitted = ledger.admit(token, phone);
        if (admitted == null) {
            Log.i(TAG, "Celular rechazado (están bloqueados los nuevos): " + phone);
            listener.onPhoneRejected();
            sendFrame(out, OP_CLOSE, new byte[] { 0x03, (byte) 0xEB });
            return;
        }

        sendFrame(out, OP_TEXT, SamsungProtocol.connected(admitted).getBytes(StandardCharsets.UTF_8));
        Log.i(TAG, "Celular conectado: " + phone);
        listener.onPhoneConnected(phone);

        while (true) {
            Frame frame = readFrame(in);
            if (frame == null) return;
            switch (frame.opcode) {
                case OP_CLOSE:
                    sendFrame(out, OP_CLOSE, new byte[0]);
                    return;
                case OP_PING:
                    sendFrame(out, OP_PONG, frame.payload);
                    break;
                case OP_TEXT:
                case OP_CONTINUATION:
                    if (frame.text != null) {
                        RemoteCommand command = SamsungProtocol.parse(frame.text);
                        if (command != null) {
                            Log.d(TAG, "Orden del celular: " + command.kind
                                + (command.key == null ? "" : " " + command.key)
                                + (command.dx == 0 && command.dy == 0 ? "" : " (" + command.dx + "," + command.dy + ")"));
                            listener.onCommand(command);
                        }
                    }
                    break;
                default:
                    break;
            }
        }
    }

    private static String acceptKey(String clientKey) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest = sha1.digest((clientKey + WS_GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.encodeToString(digest, Base64.NO_WRAP);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static final class Frame {
        final int opcode;
        final byte[] payload;
        final String text;

        Frame(int opcode, byte[] payload, String text) {
            this.opcode = opcode;
            this.payload = payload;
            this.text = text;
        }
    }

    private static Frame readFrame(InputStream in) throws IOException {
        int first = in.read();
        if (first < 0) return null;
        int second = in.read();
        if (second < 0) return null;

        int opcode = first & 0x0F;
        boolean masked = (second & 0x80) != 0;
        long length = second & 0x7F;
        if (length == 126) {
            length = ((long) readByte(in) << 8) | readByte(in);
        } else if (length == 127) {
            length = 0;
            for (int i = 0; i < 8; i++) length = (length << 8) | readByte(in);
        }
        if (length < 0 || length > MAX_FRAME_BYTES) throw new IOException("mensaje demasiado grande");

        byte[] mask = new byte[4];
        if (masked) readFully(in, mask);
        byte[] payload = new byte[(int) length];
        readFully(in, payload);
        if (masked) {
            for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        }

        String text = (opcode == OP_TEXT || opcode == OP_CONTINUATION)
            ? new String(payload, StandardCharsets.UTF_8)
            : null;
        return new Frame(opcode, payload, text);
    }

    private static void sendFrame(OutputStream out, int opcode, byte[] payload) throws IOException {
        synchronized (out) {
            out.write(0x80 | opcode);
            int length = payload.length;
            if (length < 126) {
                out.write(length);
            } else if (length < 65536) {
                out.write(126);
                out.write((length >>> 8) & 0xFF);
                out.write(length & 0xFF);
            } else {
                out.write(127);
                for (int i = 7; i >= 0; i--) out.write((int) ((long) length >>> (8 * i)) & 0xFF);
            }
            out.write(payload);
            out.flush();
        }
    }

    private static int readByte(InputStream in) throws IOException {
        int value = in.read();
        if (value < 0) throw new IOException("conexión cerrada");
        return value;
    }

    private static void readFully(InputStream in, byte[] target) throws IOException {
        int offset = 0;
        while (offset < target.length) {
            int read = in.read(target, offset, target.length - offset);
            if (read < 0) throw new IOException("conexión cerrada");
            offset += read;
        }
    }

    // ---------- Texto del protocolo HTTP ----------

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream(128);
        int read;
        while ((read = in.read()) >= 0) {
            if (read == '\n') break;
            if (read != '\r') line.write(read);
            if (line.size() > MAX_HEADER_BYTES) return null;
        }
        if (read < 0 && line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.US_ASCII);
    }

    private static Map<String, String> readHeaders(InputStream in) throws IOException {
        Map<String, String> headers = new HashMap<>();
        while (true) {
            String line = readLine(in);
            if (line == null || line.isEmpty()) break;
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            headers.put(
                line.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                line.substring(colon + 1).trim());
        }
        return headers;
    }

    private static String pathOf(String target) {
        int query = target.indexOf('?');
        String path = query < 0 ? target : target.substring(0, query);
        return path.isEmpty() ? "/" : path;
    }

    private static String queryOf(String target) {
        int query = target.indexOf('?');
        return query < 0 ? "" : target.substring(query + 1);
    }

    private static String param(String query, String name) {
        if (query.isEmpty()) return "";
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            if (!name.equals(pair.substring(0, equals))) continue;
            try {
                return URLDecoder.decode(pair.substring(equals + 1), "UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                return "";
            }
        }
        return "";
    }

    // ---------- Respuestas ----------

    /** Arma un JSON con pares clave/valor (org.json obliga a atrapar JSONException en cada put). */
    private static JSONObject json(Object... pairs) {
        JSONObject body = new JSONObject();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            try {
                body.put((String) pairs[i], pairs[i + 1]);
            } catch (org.json.JSONException ignored) {
                // Pasa sólo con claves nulas o valores no soportados: no debería ocurrir.
            }
        }
        return body;
    }

    private static void writeJson(OutputStream out, int status, JSONObject body) throws IOException {
        writeResponse(out, status, "application/json; charset=utf-8", body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void writeFile(OutputStream out, byte[] body, String mime) throws IOException {
        writeResponse(out, 200, mime, body);
    }

    private static void writeResponse(OutputStream out, int status, String contentType, byte[] body)
        throws IOException {
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
            + "Content-Type: " + contentType + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-cache\r\n"
            + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 400:
                return "Bad Request";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            default:
                return "OK";
        }
    }
}
