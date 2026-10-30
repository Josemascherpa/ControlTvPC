package ar.com.josemascherpa.cinetv.server;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Qué celulares pueden manejar la tele. Igual que una Samsung: la primera vez el celular recibe
 * una "llave" (token) que guarda y manda las próximas veces. Es el mismo comportamiento de
 * src/application/phone-access.ts en la versión de notebook.
 */
public final class PhoneLedger {

    private static final String KEY_PHONES = "phones";
    private static final String KEY_ALLOW_NEW = "allow_new";

    private final SharedPreferences prefs;
    private final SecureRandom random = new SecureRandom();

    public PhoneLedger(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public synchronized boolean allowsNew() {
        return prefs.getBoolean(KEY_ALLOW_NEW, true);
    }

    public synchronized int pairedCount() {
        return load().length();
    }

    /** La llave con la que entra el celular, o null si no lo dejamos entrar. */
    public synchronized String admit(String token, String name) {
        JSONArray phones = load();
        if (token != null && !token.isEmpty() && isKnown(phones, token)) return token;
        if (!allowsNew()) return null;
        String fresh = String.valueOf(10_000_000 + random.nextInt(90_000_000));
        JSONObject phone = new JSONObject();
        try {
            phone.put("token", fresh);
            phone.put("name", name);
            phone.put("createdAt", now());
        } catch (JSONException e) {
            return null;
        }
        phones.put(phone);
        save(phones);
        return fresh;
    }

    private boolean isKnown(JSONArray phones, String token) {
        byte[] given = token.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < phones.length(); i++) {
            JSONObject phone = phones.optJSONObject(i);
            if (phone == null) continue;
            byte[] saved = phone.optString("token", "").getBytes(StandardCharsets.UTF_8);
            // Comparación en tiempo constante: no deja adivinar la llave midiendo cuánto tarda.
            if (saved.length == given.length && MessageDigest.isEqual(saved, given)) return true;
        }
        return false;
    }

    private JSONArray load() {
        try {
            return new JSONArray(prefs.getString(KEY_PHONES, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private void save(JSONArray phones) {
        prefs.edit().putString(KEY_PHONES, phones.toString()).apply();
    }

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(new Date());
    }
}
