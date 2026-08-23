package com.jimmy.nvidiapatch.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "NvidiaPatch";
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure edge-to-edge window compatibility (Android 15+ targetSdk 35)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Set Root Window & DecorView background to pure black #0B0F17
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0B0F17"));

        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(Color.parseColor("#0B0F17"));

            ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, windowInsets) -> {
                Insets systemBars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | 
                    WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

                int top = systemBars.top;
                int bottom = ime.bottom > 0 ? ime.bottom : systemBars.bottom;
                int left = systemBars.left;
                int right = systemBars.right;

                v.setPadding(left, top, right, bottom);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        registerNativeStreamBridge();
    }

    private void registerNativeStreamBridge() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().addJavascriptInterface(new NativeStreamBridge(getBridge().getWebView()), "NativeStreamBridge");
            });
        }
    }

    public class NativeStreamBridge {
        private final WebView webView;

        public NativeStreamBridge(WebView webView) {
            this.webView = webView;
        }

        @JavascriptInterface
        public void startStream(String streamId, String urlStr, String headersJson, String bodyJson) {
            executor.submit(() -> {
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoInput(true);
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(25000);
                    conn.setReadTimeout(180000); // 3 minutes for deep reasoning models

                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Accept", "text/event-stream, application/json, */*");
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android; Mobile) NvidiaPatchChat/1.0");

                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject headers = new JSONObject(headersJson);
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            conn.setRequestProperty(key, headers.getString(key));
                        }
                    }

                    activeConnections.put(streamId, conn);

                    if (bodyJson != null && !bodyJson.isEmpty()) {
                        byte[] outputBytes = bodyJson.getBytes(StandardCharsets.UTF_8);
                        conn.setFixedLengthStreamingMode(outputBytes.length);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(outputBytes);
                            os.flush();
                        }
                    }

                    int responseCode = conn.getResponseCode();
                    if (responseCode >= 200 && responseCode < 300) {
                        InputStream is = conn.getInputStream();
                        BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                        String line;
                        while ((line = reader.readLine()) != null) {
                            if (!activeConnections.containsKey(streamId)) {
                                break; // Stream aborted
                            }
                            emitChunk(streamId, line);
                        }
                        emitDone(streamId);
                    } else {
                        InputStream es = conn.getErrorStream();
                        String errorText = "";
                        if (es != null) {
                            BufferedReader errReader = new BufferedReader(new InputStreamReader(es, StandardCharsets.UTF_8));
                            StringBuilder sb = new StringBuilder();
                            String errLine;
                            while ((errLine = errReader.readLine()) != null) {
                                sb.append(errLine);
                            }
                            errorText = sb.toString();
                        }
                        emitError(streamId, "HTTP " + responseCode + ": " + (errorText.isEmpty() ? conn.getResponseMessage() : errorText));
                    }
                } catch (Exception e) {
                    if (activeConnections.containsKey(streamId)) {
                        emitError(streamId, e.getMessage() != null ? e.getMessage() : "Network error");
                    }
                } finally {
                    activeConnections.remove(streamId);
                    if (conn != null) {
                        try {
                            conn.disconnect();
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void abortStream(String streamId) {
            HttpURLConnection conn = activeConnections.remove(streamId);
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {}
            }
            emitDone(streamId);
        }

        private void emitChunk(String streamId, String line) {
            webView.post(() -> {
                String safeLine = JSONObject.quote(line);
                webView.evaluateJavascript("if (window.__onNativeStreamChunk) { window.__onNativeStreamChunk('" + streamId + "', " + safeLine + "); }", null);
            });
        }

        private void emitDone(String streamId) {
            webView.post(() -> {
                webView.evaluateJavascript("if (window.__onNativeStreamDone) { window.__onNativeStreamDone('" + streamId + "'); }", null);
            });
        }

        private void emitError(String streamId, String error) {
            webView.post(() -> {
                String safeErr = JSONObject.quote(error);
                webView.evaluateJavascript("if (window.__onNativeStreamError) { window.__onNativeStreamError('" + streamId + "', " + safeErr + "); }", null);
            });
        }
    }
}
