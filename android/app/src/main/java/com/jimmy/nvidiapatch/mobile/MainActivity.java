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

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "NvidiaPatch";
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Set<String> explicitlyAbortedStreams = ConcurrentHashMap.newKeySet();
    private volatile String pendingSharedText = null;
    private volatile String pendingConversationId = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);

        // Ensure edge-to-edge window compatibility (Android 15+ targetSdk 35)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Set Root Window & DecorView background to pure black #0B0F17
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0B0F17"));

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        }

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

        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(android.content.Intent intent) {
        if (intent == null) return;
        if (android.content.Intent.ACTION_SEND.equals(intent.getAction())) {
            String type = intent.getType();
            if (type != null && type.startsWith("text/")) {
                String sharedText = intent.getStringExtra(android.content.Intent.EXTRA_TEXT);
                if (sharedText != null && !sharedText.trim().isEmpty()) {
                    this.pendingSharedText = sharedText.trim();
                    Log.d(TAG, "Received shared text: " + this.pendingSharedText);
                }
            }
        }
        if (intent.hasExtra("conversationId")) {
            String convId = intent.getStringExtra("conversationId");
            if (convId != null && !convId.trim().isEmpty()) {
                this.pendingConversationId = convId.trim();
                Log.d(TAG, "Received widget conversationId: " + this.pendingConversationId);
            }
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        registerNativeStreamBridge();
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
        public void startBackgroundExecution(String reason) {
            StreamForegroundService.backgroundWorkStarted(MainActivity.this, reason);
        }

        @JavascriptInterface
        public void stopBackgroundExecution() {
            StreamForegroundService.backgroundWorkFinished(MainActivity.this);
        }

        @JavascriptInterface
        public void updateWidget(String jsonStr) {
            try {
                if (jsonStr != null && !jsonStr.trim().isEmpty()) {
                    SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                    prefs.edit().putString("widget_latest_task", jsonStr).commit();
                }
                TaskWidgetProvider.refreshAllWidgets(MainActivity.this);

                Intent updateIntent = new Intent(MainActivity.this, TaskWidgetProvider.class);
                updateIntent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
                AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(MainActivity.this);
                ComponentName thisAppWidget = new ComponentName(MainActivity.this.getPackageName(), TaskWidgetProvider.class.getName());
                int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisAppWidget);
                if (appWidgetIds != null && appWidgetIds.length > 0) {
                    updateIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds);
                    MainActivity.this.sendBroadcast(updateIntent);
                }
                Log.d(TAG, "Home Screen Widget updated successfully");
            } catch (Exception e) {
                Log.w(TAG, "updateWidget failed: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public String getPendingConversationId() {
            String id = pendingConversationId;
            pendingConversationId = null;
            return id != null ? id : "";
        }

        @JavascriptInterface
        public String getPendingSharedText() {
            String text = pendingSharedText;
            pendingSharedText = null;
            return text != null ? text : "";
        }

        @JavascriptInterface
        public void startStream(String streamId, String urlStr, String headersJson, String bodyJson) {
            StreamForegroundService.streamStarted(MainActivity.this);
            try {
                executor.submit(() -> {
                    runStreamWithRetry(streamId, urlStr, headersJson, bodyJson, 0);
                });
            } catch (Exception e) {
                StreamForegroundService.streamFinished(MainActivity.this);
                Log.d(TAG, "stream submit failed: " + e.getMessage());
            }
        }

        private void runStreamWithRetry(String streamId, String urlStr, String headersJson, String bodyJson, int retryCount) {
            HttpURLConnection conn = null;
            int chunksEmitted = 0;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoInput(true);
                conn.setDoOutput(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(180000); // 3 minutes for deep reasoning models
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(true);

                // Fix Android HttpURLConnection stale pooled socket bug that causes "Software caused connection abort"
                conn.setRequestProperty("Connection", "close");
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
                        if (explicitlyAbortedStreams.contains(streamId) || !activeConnections.containsKey(streamId)) {
                            break; // Stream aborted
                        }
                        emitChunk(streamId, line);
                        chunksEmitted++;
                    }
                    if (!explicitlyAbortedStreams.contains(streamId)) {
                        emitDone(streamId);
                    }
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
                if (explicitlyAbortedStreams.contains(streamId)) {
                    return; // Deliberately cancelled by user, ignore
                }
                String msg = e.getMessage() != null ? e.getMessage() : "";
                boolean isTransient = msg.contains("abort") || msg.contains("reset") || msg.contains("closed") || msg.contains("Broken pipe") || msg.contains("EOFException");
                if (retryCount < 1 && chunksEmitted == 0 && isTransient) {
                    Log.w(TAG, "Transient connection error (" + msg + "), auto-retrying in 500ms...");
                    try { Thread.sleep(500); } catch (InterruptedException ignored) {}
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                    runStreamWithRetry(streamId, urlStr, headersJson, bodyJson, retryCount + 1);
                    return;
                }
                if (activeConnections.containsKey(streamId)) {
                    emitError(streamId, msg.isEmpty() ? "Network error" : msg);
                }
            } finally {
                activeConnections.remove(streamId);
                explicitlyAbortedStreams.remove(streamId);
                StreamForegroundService.streamFinished(MainActivity.this);
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored) {}
                }
            }
        }

        @JavascriptInterface
        public void abortStream(String streamId) {
            explicitlyAbortedStreams.add(streamId);
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
