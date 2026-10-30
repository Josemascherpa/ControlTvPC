package ar.com.josemascherpa.cinetv.server;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;

/** La IP de la tele en la red de la casa (la que el celular usa para encontrarla). */
public final class Net {

    private Net() {
    }

    public static String localIpv4() {
        String wifi = addressOf("wlan", "eth", "ap", "rndis", "swlan");
        if (wifi != null) return wifi;
        String any = addressOf();
        return any == null ? "127.0.0.1" : any;
    }

    private static String addressOf(String... prefixes) {
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                if (prefixes.length > 0 && !startsWithAny(nic.getName(), prefixes)) continue;
                for (InetAddress address : Collections.list(nic.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String host = address.getHostAddress();
                        if (host != null) return host;
                    }
                }
            }
        } catch (SocketException ignored) {
            // Sin red: queda 127.0.0.1.
        }
        return null;
    }

    private static boolean startsWithAny(String value, String... prefixes) {
        for (String prefix : prefixes) {
            if (value.startsWith(prefix)) return true;
        }
        return false;
    }
}
