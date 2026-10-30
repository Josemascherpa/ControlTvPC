package ar.com.josemascherpa.cinetv.server;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import ar.com.josemascherpa.cinetv.remote.RemoteCommand;

/**
 * El "idioma Samsung": la app ControlTv del celular sabe manejar teles Samsung, así que la tele
 * habla ese mismo idioma y la app la encuentra sin cambiarle nada. Este archivo es el traductor:
 * lo que llega en Samsung se convierte en un RemoteCommand propio.
 *
 * Es el equivalente de src/infrastructure/http/samsung-protocol.ts (la notebook usa lo mismo).
 */
public final class SamsungProtocol {

    public static final String REMOTE_PATH = "/api/v2/channels/samsung.remote.control";
    /** La dirección con la que las Samsung se presentan. La app del celular la prueba primero. */
    public static final String INFO_PATH = "/api/v2";

    private static final Map<String, String> KEYS = new HashMap<>();

    static {
        KEYS.put("KEY_POWER", "POWER");
        KEYS.put("KEY_POWEROFF", "POWER");
        KEYS.put("KEY_HOME", "HOME");
        KEYS.put("KEY_RETURN", "BACK");
        KEYS.put("KEY_MENU", "MENU");
        KEYS.put("KEY_UP", "UP");
        KEYS.put("KEY_DOWN", "DOWN");
        KEYS.put("KEY_LEFT", "LEFT");
        KEYS.put("KEY_RIGHT", "RIGHT");
        KEYS.put("KEY_ENTER", "OK");
        KEYS.put("KEY_VOLUP", "VOLUME_UP");
        KEYS.put("KEY_VOLDOWN", "VOLUME_DOWN");
        KEYS.put("KEY_MUTE", "MUTE");
        KEYS.put("KEY_CHUP", "CHANNEL_UP");
        KEYS.put("KEY_CHDOWN", "CHANNEL_DOWN");
        KEYS.put("KEY_PLAY", "PLAY_PAUSE");
        KEYS.put("KEY_PAUSE", "PLAY_PAUSE");
    }

    private SamsungProtocol() {
    }

    /** Traduce un mensaje del celular. Devuelve null si no es algo que sepamos hacer. */
    public static RemoteCommand parse(String text) {
        JSONObject message;
        try {
            message = new JSONObject(text);
        } catch (JSONException e) {
            return null;
        }
        String method = message.optString("method", "");
        JSONObject params = message.optJSONObject("params");
        if (params == null) return null;

        if ("ms.remote.control".equals(method)) {
            switch (params.optString("TypeOfRemote", "")) {
                case "SendRemoteKey": {
                    String key = KEYS.get(params.optString("DataOfCmd", ""));
                    return key == null ? null : RemoteCommand.key(key);
                }
                case "SendInputString":
                    // El texto viene en Base64.
                    return RemoteCommand.text(decodeBase64(params.optString("Cmd", "")));
                case "ProcessMouseDevice": {
                    // El touchpad de la pestaña "Mouse": Move (cuánto se movió el dedo) y LeftClick.
                    String cmd = params.optString("Cmd", "");
                    if ("LeftClick".equals(cmd)) return RemoteCommand.pointerClick();
                    JSONObject position = params.optJSONObject("Position");
                    if ("Move".equals(cmd) && position != null) {
                        return RemoteCommand.pointerMove(position.optInt("x", 0), position.optInt("y", 0));
                    }
                    return null;
                }
                default:
                    return null;
            }
        }
        // "Abrir página" y las búsquedas: la app pide abrir el navegador con una dirección.
        if ("ms.channel.emit".equals(method) && "ed.apps.launch".equals(params.optString("event", ""))) {
            JSONObject data = params.optJSONObject("data");
            String url = data == null ? "" : data.optString("metaTag", "");
            return url.isEmpty() ? null : RemoteCommand.openUrl(url);
        }
        return null;
    }

    /** La app manda su nombre en Base64 (ej. "ControlTv"). */
    public static String decodeClientName(String base64) {
        String name = decodeBase64(base64).trim();
        if (name.isEmpty()) return "Celular";
        return name.length() > 40 ? name.substring(0, 40) : name;
    }

    public static String connected(String token) {
        JSONObject data = object("id", UUID.randomUUID().toString(), "token", token, "clients", new JSONArray());
        return object("event", "ms.channel.connect", "data", data).toString();
    }

    public static String unauthorized() {
        return object("event", "ms.channel.unauthorized").toString();
    }

    /**
     * Lo que contesta una Samsung en /api/v2/: nombre, modelo y estado. La app del celular usa
     * device.name para mostrarla en la lista, y PowerState para saber si tiene que "prenderla".
     * La tele está siempre prendida (la app no puede apagar el televisor), así que dice "on".
     */
    public static JSONObject deviceInfo(String name, String ip, int port, String deviceId) {
        JSONObject device = object(
            "id", deviceId, "name", name, "type", "Samsung SmartTV", "modelName", "Cine TV",
            "ip", ip, "networkType", "wireless", "TokenAuthSupport", "true", "PowerState", "on",
            "OS", "Tizen");
        return object(
            "cineTv", true,
            "id", deviceId,
            "name", name,
            "type", "Samsung SmartTV",
            "version", "2.0.25",
            "remote", "1.0",
            "uri", "http://" + ip + ":" + port + "/api/v2/",
            "isSupport", "{\"remote_available\":\"true\",\"remote_fourDirections\":\"true\","
                + "\"remote_touchPad\":\"true\",\"remote_voiceControl\":\"false\"}",
            "device", device);
    }

    private static String decodeBase64(String value) {
        try {
            return new String(Base64.decode(value, Base64.DEFAULT), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return "";
        }
    }

    /** Arma un JSON con pares clave/valor (org.json obliga a atrapar JSONException en cada put). */
    private static JSONObject object(Object... pairs) {
        JSONObject json = new JSONObject();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            try {
                json.put((String) pairs[i], pairs[i + 1]);
            } catch (JSONException ignored) {
                // Pasa sólo con claves nulas o valores no soportados: no debería ocurrir.
            }
        }
        return json;
    }
}
