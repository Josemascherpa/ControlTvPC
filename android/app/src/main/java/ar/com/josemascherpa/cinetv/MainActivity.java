package ar.com.josemascherpa.cinetv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.window.OnBackInvokedDispatcher;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import ar.com.josemascherpa.cinetv.screen.Screen;

/**
 * La tele: un WebView a pantalla completa con el Cine y el mando de la tele (D-pad) traducido a las
 * teclas que entiende la página. También es la "pantalla" que usa el control remoto del celular.
 *
 * No hay AndroidX ni Compose a propósito: así instala y anda en televisores viejos y en los que no
 * tienen Play Store (Google TV, Android TV, Fire TV y TV boxes).
 */
public final class MainActivity extends Activity implements Screen {

    private static final String TAG = "CineTV";

    private CineTvApp app;
    private WebView webView;
    private View splash;
    private View powerOff;
    private TextView errorView;
    private TextView errorText;
    private boolean touchMode;
    private boolean powerOffState;
    private boolean errorState;
    private boolean pageReady;
    private boolean backPending;
    private long lastBackAt;

    // ---------- Ciclo de vida ----------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        app = (CineTvApp) getApplication();
        UiModeManager modes = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        boolean television = modes != null && modes.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        touchMode = !television && getPackageManager().hasSystemFeature("android.hardware.touchscreen");
        setRequestedOrientation(touchMode ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        setContentView(buildUi());
        app.attach(this);
        loadCine();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        app.setPaused(false);
        if (webView != null && !powerOffState) webView.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        app.setPaused(true);
        pausePlayback();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        app.detach(this);
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.removeJavascriptInterface("CineTvDevice");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // ---------- Interfaz ----------

    private View buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        webView = new WebView(this);
        webView.setAlpha(0f);
        configureWebView();
        root.addView(webView, fill());

        splash = buildSplash();
        root.addView(splash, fill());

        errorView = buildError();
        root.addView(errorView, fill());
        errorView.setVisibility(View.GONE);

        // "Apagar la imagen" del botón de encendido del celular: tapa todo de negro.
        powerOff = new View(this);
        powerOff.setBackgroundColor(Color.BLACK);
        powerOff.setClickable(true);
        powerOff.setVisibility(View.GONE);
        powerOff.setOnClickListener(v -> setPowerOff(false));
        root.addView(powerOff, fill());

        return root;
    }

    private View buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.BLACK);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        ProgressBar bar = new ProgressBar(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(28), dp(28));
        params.topMargin = dp(24);
        box.addView(bar, params);
        return box;
    }

    private TextView buildError() {
        errorText = new TextView(this);
        errorText.setGravity(Gravity.CENTER);
        errorText.setTextColor(Color.WHITE);
        errorText.setTextSize(20);
        errorText.setBackgroundColor(Color.BLACK);
        errorText.setText("No se pudo cargar el Cine.\nRevisá la conexión a internet.\n\nApretá OK para reintentar.");
        return errorText;
    }

    private FrameLayout.LayoutParams fill() {
        return new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // El celular manda las teclas por JavaScript (no cuentan como "gesto"): hay que dejar
        // que el video arranque igual.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // La tele no debe agrandar el texto por la configuración del sistema: rompería el diseño.
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        if (Build.VERSION.SDK_INT >= 26) webView.setDefaultFocusHighlightEnabled(false);
        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        if (touchMode) webView.addJavascriptInterface(new DeviceBridge(), "CineTvDevice");
        webView.setWebViewClient(new CineClient());
        webView.setWebChromeClient(new CineChrome());

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true);
    }

    private void loadCine() {
        int port = app.awaitPort();
        if (port <= 0) {
            showError("No se pudo abrir el servidor del Cine.");
            return;
        }
        errorState = false;
        pageReady = false;
        errorView.setVisibility(View.GONE);
        webView.loadUrl("http://127.0.0.1:" + port + (touchMode ? "/?touch=1" : "/"));
    }

    private void showCine() {
        if (webView == null) return;
        pageReady = true;
        webView.requestFocus();
        webView.setAlpha(1f);
        if (splash != null) {
            splash.animate().alpha(0f).setDuration(300).withEndAction(() -> {
                if (splash != null) splash.setVisibility(View.GONE);
            }).start();
        }
        // El catálogo coloca el foco al recibir sus datos; no enviar Inicio después de cargar.
    }

    private void showError(String message) {
        errorState = true;
        pageReady = false;
        if (errorText != null) {
            errorText.setText(message + "\n\nApretá OK para reintentar.");
            errorView.setVisibility(View.VISIBLE);
        }
    }

    // ---------- Mando de la tele ----------

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Con la imagen apagada, cualquier botón la prende (y no hace nada más).
        if (powerOffState) {
            setPowerOff(false);
            return true;
        }
        if (errorState) {
            loadCine();
            return true;
        }
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                key("ArrowUp");
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                key("ArrowDown");
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                key("ArrowLeft");
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                key("ArrowRight");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                key("Enter");
                return true;
            case KeyEvent.KEYCODE_MENU:
                home();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                togglePlayback();
                return true;
            case KeyEvent.KEYCODE_CHANNEL_UP:
                key("PageUp");
                return true;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                key("PageDown");
                return true;
            default:
                // Las letras van al WebView (por si hay un teclado conectado).
                return super.onKeyDown(keyCode, event);
        }
    }

    // Android 13+ usa el callback nativo registrado en onCreate; este cubre Android 7–12.
    @SuppressLint("GestureBackNavigation")
    @Override
    public void onBackPressed() {
        back();
    }

    // ---------- Screen: lo que pide el celular ----------

    @Override
    public void key(String pageKey) {
        runJs("window.__cineTv&&window.__cineTv.key(" + js(pageKey) + ")");
    }

    @Override
    public void back() {
        onUi(this::handleBack);
    }

    private void handleBack() {
        // "Atrás" puede llegar dos veces (tecla y gesto del sistema): se atiende una sola.
        long now = SystemClock.uptimeMillis();
        if (backPending || now - lastBackAt < 400) return;
        if (!pageReady) {
            finish();
            return;
        }
        lastBackAt = now;
        backPending = true;
        // El Cine contesta si cerró algo; sólo se sale de la app si no había nada abierto.
        call("window.__cineTv?window.__cineTv.back():false", value -> {
            backPending = false;
            if ("false".equals(value)) finish();
        });
        // Si la página no contesta (se colgó), no dejamos Atrás trabado.
        if (webView != null) webView.postDelayed(() -> backPending = false, 400);
    }

    @Override
    public void home() {
        runJs("window.__cineTv&&window.__cineTv.home()");
    }

    @Override
    public void text(String text) {
        runJs("window.__cineTv&&window.__cineTv.text(" + js(text) + ")");
        // En la tele no hace falta el teclado del sistema: el Cine ya tiene el suyo en pantalla.
        if (!touchMode) hideKeyboardSoon();
    }

    @Override
    public void search(String query) {
        runJs("window.__cineTv&&window.__cineTv.search(" + js(query) + ")");
    }

    @Override
    public void togglePlayback() {
        runJs("window.__cineTv&&window.__cineTv.togglePlayback()");
    }

    @Override
    public void pausePlayback() {
        runJs("window.__cineTv&&window.__cineTv.pause()");
    }

    @Override
    public void cursorMove(int dx, int dy) {
        runJs("window.__cineTv&&window.__cineTv.cursorMove(" + dx + "," + dy + ")");
    }

    @Override
    public void cursorClick() {
        runJs("window.__cineTv&&window.__cineTv.cursorClick()");
    }

    @Override
    public void togglePower() {
        onUi(() -> setPowerOff(!powerOffState));
    }

    @Override
    public boolean isPictureOff() {
        return powerOffState;
    }

    @Override
    public void wakePicture() {
        onUi(() -> setPowerOff(false));
    }

    @Override
    public void showVolume(int level, boolean muted) {
        runJs("window.__cineTv&&window.__cineTv.volume(" + level + "," + muted + ")");
    }

    @Override
    public void toast(String text, String icon) {
        runJs("window.__cineTv&&window.__cineTv.toast(" + js(text) + "," + js(icon) + ")");
    }

    private void setPowerOff(boolean off) {
        powerOffState = off;
        if (powerOff != null) powerOff.setVisibility(off ? View.VISIBLE : View.GONE);
        if (webView == null) return;
        if (off) {
            pausePlayback();
            webView.onPause();
        } else {
            webView.onResume();
        }
    }

    // ---------- Puente con la página ----------

    private void runJs(String script) {
        WebView view = webView;
        if (view == null) return;
        view.post(() -> {
            try {
                view.evaluateJavascript(script, null);
            } catch (RuntimeException e) {
                Log.w(TAG, "No se pudo hablar con el Cine: " + e);
            }
        });
    }

    /** El servidor del celular contesta en su propio hilo: las vistas sólo se tocan desde el principal. */
    private void onUi(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            runOnUiThread(action);
        }
    }

    /** Después de escribir desde el celular no hace falta el teclado del sistema. */
    private void hideKeyboardSoon() {
        WebView view = webView;
        if (view == null) return;
        view.postDelayed(() -> {
            try {
                InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(view.getWindowToken(), 0);
            } catch (RuntimeException ignored) {
                // No hay teclado del sistema: nada que esconder.
            }
        }, 350);
    }

    private void call(String script, java.util.function.Consumer<String> result) {
        WebView view = webView;
        if (view == null) return;
        view.post(() -> {
            try {
                view.evaluateJavascript(script, value -> {
                    if (result != null) result.accept(value);
                });
            } catch (RuntimeException e) {
                Log.w(TAG, "No se pudo hablar con el Cine: " + e);
            }
        });
    }

    private static String js(String value) {
        return JSONObject.quote(value);
    }

    private boolean isLocal(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost());
    }

    // ---------- WebView ----------

    /** Puente limitado a orientación; no expone archivos, intents ni comandos del sistema. */
    public final class DeviceBridge {
        @JavascriptInterface
        public void playback(boolean active) {
            runOnUiThread(() -> {
                if (!touchMode || isFinishing() || isDestroyed()) return;
                setRequestedOrientation(active ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            });
        }
    }

    private final class CineClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Sólo el Cine: cualquier otro enlace se ignora (no hay navegador ni otras apps).
            return !isLocal(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            showCine();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError("No se pudo cargar el Cine.");
        }
    }

    private final class CineChrome extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, "Cine: " + message.message() + " (" + message.lineNumber() + ")");
            return true;
        }
    }
}
