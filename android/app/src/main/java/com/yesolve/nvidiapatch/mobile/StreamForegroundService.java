package com.yesolve.nvidiapatch.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class StreamForegroundService extends Service {
    private static final String TAG = "NvidiaPatch";
    private static final String CHANNEL_ID = "llm_stream_channel";
    private static final String RESULT_CHANNEL_ID = "task_result_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final long STOP_DELAY_MS = 5000L; // Stop service 5s after completion
    private static final long WAKE_LOCK_TIMEOUT_MS = 10L * 60 * 1000; // Strict 10-minute safety cap

    public static final String ACTION_RUN_SCHEDULED_ALARM = "com.yesolve.nvidiapatch.ACTION_RUN_SCHEDULED_ALARM";
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String KEY_PENDING_NATIVE_RESULTS = "pending_native_task_results";
    private static final String KEY_WIDGET_LATEST_TASK = "widget_latest_task";
    private static final String KEY_WIDGET_TASKS_LIST = "widget_tasks_list";
    private static final String KEY_WIDGET_SELECTED_TASK_ID = "widget_selected_task_id";

    private static final Object lock = new Object();
    private static int activeStreams = 0;
    private static int backgroundTasks = 0;
    private static boolean running = false;
    private static Handler handler;
    private static Context appContext;
    private static PowerManager.WakeLock wakeLock;
    private static String currentNotificationText = "⏳ 正在背景維持 AI 服務…";
    private static final ExecutorService alarmExecutor = Executors.newSingleThreadExecutor();
    private static final Set<String> nativeRunningTaskIds = ConcurrentHashMap.newKeySet();
    private static final Map<String, Long> jsClaimedTasks = new ConcurrentHashMap<>();

    public static void markTaskClaimedByJs(Context ctx, String taskId, long advancedNextRunAt) {
        if (taskId == null || taskId.trim().isEmpty()) return;
        String cleanId = taskId.trim();
        jsClaimedTasks.put(cleanId, System.currentTimeMillis() + 5L * 60L * 1000L);
        if (ctx == null) return;
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String rawSync = prefs.getString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, null);
            if (rawSync != null && !rawSync.trim().isEmpty()) {
                JSONArray arr = new JSONArray(rawSync);
                boolean changed = false;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.optJSONObject(i);
                    if (obj != null && cleanId.equals(obj.optString("id", "").trim())) {
                        if (advancedNextRunAt > 0L) {
                            obj.put("nextRunAt", advancedNextRunAt);
                        } else {
                            obj.put("nextRunAt", JSONObject.NULL);
                            obj.put("enabled", false);
                        }
                        changed = true;
                        break;
                    }
                }
                if (changed) {
                    prefs.edit().putString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, arr.toString()).commit();
                    ScheduleAlarmReceiver.scheduleNextAlarm(ctx);
                }
            }
        } catch (Exception ignored) {}
    }

    public static String getNativeTaskStateJson(Context ctx, String taskId) {
        if (taskId == null || taskId.trim().isEmpty()) return "{\"running\":false}";
        String cleanId = taskId.trim();
        boolean isRunning = nativeRunningTaskIds.contains(cleanId);
        long nextRunAt = 0L;
        long lastRunAt = 0L;
        if (ctx != null) {
            try {
                SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String rawSync = prefs.getString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, null);
                if (rawSync != null && !rawSync.trim().isEmpty()) {
                    JSONArray arr = new JSONArray(rawSync);
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject obj = arr.optJSONObject(i);
                        if (obj != null && cleanId.equals(obj.optString("id", "").trim())) {
                            nextRunAt = obj.optLong("nextRunAt", 0L);
                            lastRunAt = obj.optLong("lastRunAt", 0L);
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        try {
            JSONObject out = new JSONObject();
            out.put("running", isRunning);
            out.put("nextRunAt", nextRunAt > 0L ? nextRunAt : JSONObject.NULL);
            out.put("lastRunAt", lastRunAt > 0L ? lastRunAt : JSONObject.NULL);
            return out.toString();
        } catch (Exception e) {
            return "{\"running\":" + isRunning + "}";
        }
    }

    private static final Runnable stopRunnable = new Runnable() {
        @Override
        public void run() {
            Context ctx;
            synchronized (lock) {
                if (activeStreams > 0 || backgroundTasks > 0 || !running) return;
                running = false;
                ctx = appContext;
            }
            if (ctx != null) {
                try {
                    ctx.stopService(new Intent(ctx, StreamForegroundService.class));
                } catch (Exception e) {
                    Log.d(TAG, "FGS stop failed: " + e.getMessage());
                }
            }
        }
    };

    private static void ensureServiceStarted(Context context) {
        if (context == null) return;
        boolean needStart;
        synchronized (lock) {
            if (handler != null) handler.removeCallbacks(stopRunnable);
            needStart = !running;
            appContext = context.getApplicationContext();
        }
        if (needStart) {
            Intent intent = new Intent(context.getApplicationContext(), StreamForegroundService.class);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.getApplicationContext().startForegroundService(intent);
                } else {
                    context.getApplicationContext().startService(intent);
                }
            } catch (Exception e) {
                Log.d(TAG, "FGS start failed: " + e.getMessage());
            }
        } else {
            updateOngoingNotification(context.getApplicationContext());
        }
    }

    private static void updateOngoingNotification(Context context) {
        if (context == null) return;
        synchronized (lock) {
            if (!running) return;
        }
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, buildOngoingNotification(context));
            }
        } catch (Exception e) {
            Log.d(TAG, "updateOngoingNotification failed: " + e.getMessage());
        }
    }

    public static void streamStarted(Context context) {
        synchronized (lock) {
            activeStreams++;
            currentNotificationText = "⏳ 正在背景接收 AI 回應…";
        }
        ensureServiceStarted(context);
    }

    public static void streamFinished(Context context) {
        boolean shouldScheduleStop = false;
        synchronized (lock) {
            if (activeStreams > 0) activeStreams--;
            if (activeStreams == 0 && backgroundTasks == 0) {
                releaseWakeLock();
                shouldScheduleStop = true;
            } else if (backgroundTasks > 0) {
                currentNotificationText = "⏳ 正在背景執行任務排程…";
            }
        }
        if (shouldScheduleStop) {
            synchronized (lock) {
                if (running && handler != null) {
                    handler.postDelayed(stopRunnable, STOP_DELAY_MS);
                }
            }
        } else if (context != null) {
            updateOngoingNotification(context.getApplicationContext());
        }
    }

    public static void backgroundWorkStarted(Context context, String reason) {
        synchronized (lock) {
            backgroundTasks++;
            if (reason != null && !reason.trim().isEmpty()) {
                String cleanReason = reason.trim();
                currentNotificationText = cleanReason.startsWith("⏳") ? cleanReason : ("⏳ " + cleanReason);
            } else {
                currentNotificationText = "⏳ 正在背景執行任務排程…";
            }
        }
        ensureServiceStarted(context);
    }

    public static void backgroundWorkFinished(Context context) {
        boolean shouldScheduleStop = false;
        synchronized (lock) {
            if (backgroundTasks > 0) backgroundTasks--;
            if (activeStreams == 0 && backgroundTasks == 0) {
                releaseWakeLock();
                shouldScheduleStop = true;
            } else if (activeStreams > 0) {
                currentNotificationText = "⏳ 正在背景接收 AI 回應…";
            }
        }
        if (shouldScheduleStop) {
            synchronized (lock) {
                if (running && handler != null) {
                    handler.postDelayed(stopRunnable, STOP_DELAY_MS);
                }
            }
        } else if (context != null) {
            updateOngoingNotification(context.getApplicationContext());
        }
    }

    public static void onScheduleAlarmTriggered(Context context) {
        if (context == null) return;
        Context ctx = context.getApplicationContext();
        backgroundWorkStarted(ctx, "正在喚醒排程任務…");
        Intent intent = new Intent(ctx, StreamForegroundService.class);
        intent.setAction(ACTION_RUN_SCHEDULED_ALARM);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "onScheduleAlarmTriggered startForegroundService failed: " + e.getMessage());
            alarmExecutor.submit(() -> {
                try {
                    handleAlarmExecution(ctx);
                } finally {
                    backgroundWorkFinished(ctx);
                }
            });
        }
    }

    private static void handleAlarmExecution(Context ctx) {
        if (MainActivity.isWebViewActive()) {
            MainActivity.notifyAlarmTriggeredToWebView();
            try {
                Thread.sleep(2500L);
            } catch (InterruptedException ignored) {}
        }
        executeDueTasksNatively(ctx);
    }

    private static String stripSummaryFormatting(String str) {
        if (str == null) return "";
        return str
                .replaceAll("(?si)<widget-summary\\b[^>]*>[\\s\\S]*?(?:</widget-summary>|$)", "")
                .replaceAll("(?si)<options[\\s\\S]*?</options>", "")
                .replaceAll("(?si)<options[\\s\\S]*", "")
                .replaceAll("(?si)<option\\b[^>]*?(?:/>|>[\\s\\S]*?</option>)", "")
                .replaceAll("(?i)<meihua-numbers[^>]*>.*?</meihua-numbers>", "")
                .replaceAll("(?i)<meihua-numbers[^>]*/>", "")
                .replaceAll("(?m)^#+\\s+", "")
                .replace("**", "")
                .replaceAll("(?s)```[\\s\\S]*?```", "")
                .replaceAll("`{1,3}[^`]*`{1,3}", "")
                .replaceAll("\\n{2,}", "\n")
                .trim();
    }

    private static String stripWidgetSummaryTag(String raw) {
        if (raw == null) return "";
        String unwrapped = raw.replaceAll("(?si)```(?:xml|html)?\\s*\\r?\\n?\\s*(<widget-summary\\b[\\s\\S]*?</widget-summary>)\\s*\\r?\\n?\\s*```", "$1");
        return unwrapped
                .replaceAll("(?si)<widget-summary\\b[^>]*>[\\s\\S]*?(?:</widget-summary>|$)", "")
                .trim();
    }

    private static boolean containsCjk(String text) {
        if (text == null) return false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if ((c >= '\u4E00' && c <= '\u9FFF') || (c >= '\u3040' && c <= '\u30FF') || (c >= '\uAC00' && c <= '\uD7AF')) {
                return true;
            }
        }
        return false;
    }

    private static String clampWidgetSummary(String raw, int maxCjk) {
        if (raw == null) return "";
        String normalized = raw.replaceAll("\\s+", " ").trim();
        if (normalized.isEmpty()) return "";
        int limit = containsCjk(normalized) ? maxCjk : 60;
        if (normalized.length() <= limit) return normalized;
        String slice = normalized.substring(0, limit);
        int minCut = (int) (limit * 0.55);
        for (int i = slice.length() - 1; i >= minCut; i--) {
            char ch = slice.charAt(i);
            if ("。！？!?".indexOf(ch) >= 0) {
                return slice.substring(0, i + 1).trim();
            }
            if ("，,；;、 ".indexOf(ch) >= 0) {
                String head = slice.substring(0, i).replaceAll("[，,；;、:\\s]+$", "").trim();
                if (head.length() >= 4) {
                    return head.length() + 1 <= limit ? (head + "…") : head;
                }
            }
        }
        return normalized.substring(0, Math.max(1, limit - 1)).trim() + "…";
    }

    private static String extractWidgetSummary(String raw, boolean isFailed) {
        String source = raw != null ? raw : "";
        String unwrapped = source.replaceAll("(?si)```(?:xml|html)?\\s*\\r?\\n?\\s*(<widget-summary\\b[\\s\\S]*?</widget-summary>)\\s*\\r?\\n?\\s*```", "$1");

        if (isFailed) {
            String errClean = cleanSummaryForDisplay(stripWidgetSummaryTag(unwrapped))
                    .replaceFirst("(?i)^\\[(?:排程執行)?錯誤\\][:：]?\\s*", "")
                    .replaceAll("\\s+", " ")
                    .trim();
            return clampWidgetSummary(errClean.isEmpty() ? "⚠️ 排程執行失敗" : ("⚠️ 失敗：" + errClean), 30);
        }

        java.util.regex.Matcher closedMatcher = java.util.regex.Pattern
                .compile("(?si)<widget-summary\\b[^>]*>([\\s\\S]*?)</widget-summary>")
                .matcher(unwrapped);
        String explicit = null;
        if (closedMatcher.find()) {
            explicit = closedMatcher.group(1);
        } else {
            java.util.regex.Matcher openMatcher = java.util.regex.Pattern
                    .compile("(?si)<widget-summary\\b[^>]*>([\\s\\S]*)$")
                    .matcher(unwrapped);
            if (openMatcher.find()) {
                explicit = openMatcher.group(1);
            }
        }

        if (explicit != null) {
            String cleanedExplicit = cleanSummaryForDisplay(explicit).replaceAll("\\s+", " ").trim();
            if (!cleanedExplicit.isEmpty()) {
                return clampWidgetSummary(cleanedExplicit, 30);
            }
        }

        String cleanedBody = cleanSummaryForDisplay(stripWidgetSummaryTag(unwrapped));
        if (cleanedBody.isEmpty()) return "排程任務已完成";

        String[] lines = cleanedBody.split("\\r?\\n");
        String bestSentence = null;
        int bestScore = -1;
        for (String rawLine : lines) {
            String line = rawLine.trim()
                    .replaceFirst("^[-*•●▪▸]+\\s*", "")
                    .replaceFirst("^\\d+[.)、]\\s*", "")
                    .replaceFirst("^(?:好的|沒問題|收到|了解|您好|哈囉|嗨)[，,！!。\\s]+", "")
                    .replaceFirst("^(?:以下(?:是|為您)?(?:整理|分析|說明|報告|摘要)?|為您(?:分析|整理|提供)如下)[：:，,\\s]*", "")
                    .trim();
            if (line.isEmpty() || line.matches("^[-*_=#~]{2,}$")) continue;
            if (line.matches("^(?:好的|沒問題|收到|了解|當然|您好|哈囉|嗨|以下(?:是|為您)?(?:整理|分析|說明|報告|建議)?)[！!。，,：:\\s]*$")) continue;

            String[] sentences = line.split("(?<=[。！？!?])\\s*");
            for (String sRaw : sentences) {
                String s = sRaw.trim();
                if (s.isEmpty()) continue;
                if (s.matches(".*(?:如下|分析如下)[：:]\\s*$") && lines.length > 1) continue;
                int score = 0;
                if (s.matches(".*(結論|總結|總評|綜合|核心|summary|conclusion).*")) score += 100;
                if (s.matches(".*(建議|重點|結果|狀態|提醒|注意|吉凶|大吉|中吉|小吉|平|凶|宜|忌|趨勢|風險|完成|成功|失敗).*")) score += 40;
                if (s.length() >= 6 && s.length() <= 45) score += 10;
                if (s.length() < 4) score -= 20;
                if (score > bestScore) {
                    bestScore = score;
                    bestSentence = s;
                }
            }
        }
        String chosen = (bestSentence != null ? bestSentence : cleanedBody)
                .replaceFirst("^(?:結論|總結|總評|綜合建議|綜合評斷|綜合評估|重點摘要|核心結論|執行結果)[：:\\s]+", "")
                .trim();
        return clampWidgetSummary(chosen.isEmpty() ? cleanedBody : chosen, 30);
    }

    private static String cleanSummaryForDisplay(String raw) {
        if (raw == null) return "";
        String withoutThink = stripSummaryFormatting(
                raw.replaceAll("(?si)<think>[\\s\\S]*?</think>", "")
                   .replaceAll("(?si)<think>[\\s\\S]*", "")
        );
        if (!withoutThink.isEmpty()) {
            return withoutThink;
        }
        return stripSummaryFormatting(raw.replaceAll("(?i)</?think>", ""));
    }

    private static long calculateNextRunTimeMs(String timeStr, String repeat, long fromMillis) {
        int hour = 8;
        int minute = 0;
        try {
            String[] parts = (timeStr != null && !timeStr.isEmpty() ? timeStr : "08:00").split(":");
            if (parts.length >= 1) hour = Integer.parseInt(parts[0].trim());
            if (parts.length >= 2) minute = Integer.parseInt(parts[1].trim());
        } catch (Exception ignored) {}

        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(fromMillis);
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);

        if (cal.getTimeInMillis() <= fromMillis) {
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }

        if (repeat != null && repeat.startsWith("weekly:")) {
            Set<Integer> allowedDays = new HashSet<>();
            String[] dayParts = repeat.replace("weekly:", "").split(",");
            for (String dp : dayParts) {
                try {
                    allowedDays.add(Integer.parseInt(dp.trim()));
                } catch (Exception ignored) {}
            }
            if (!allowedDays.isEmpty()) {
                for (int i = 0; i < 7; i++) {
                    int jsDay = cal.get(Calendar.DAY_OF_WEEK) - 1; // Sun=1->0, Mon=2->1 ... Sat=7->6
                    if (allowedDays.contains(jsDay)) {
                        return cal.getTimeInMillis();
                    }
                    cal.add(Calendar.DAY_OF_MONTH, 1);
                }
            }
        }
        return cal.getTimeInMillis();
    }

    private static void executeDueTasksNatively(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String rawSync = prefs.getString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, null);
        if (rawSync == null || rawSync.trim().isEmpty()) {
            return;
        }

        JSONArray tasksArr;
        try {
            tasksArr = new JSONArray(rawSync);
        } catch (Exception e) {
            Log.w(TAG, "executeDueTasksNatively invalid JSON: " + e.getMessage());
            return;
        }

        long now = System.currentTimeMillis();
        for (int i = 0; i < tasksArr.length(); i++) {
            JSONObject taskObj = tasksArr.optJSONObject(i);
            if (taskObj == null) continue;

            String taskId = taskObj.optString("id", "").trim();
            if (taskId.isEmpty()) continue;
            boolean enabled = taskObj.optBoolean("enabled", false);
            long nextRunAt = taskObj.optLong("nextRunAt", 0L);

            if (!enabled || nextRunAt <= 0L) continue;
            if (nextRunAt > now) continue;

            // Stale guard (> 4 hours overdue)
            if (now - nextRunAt > 4L * 3600L * 1000L) {
                long newNext = calculateNextRunTimeMs(taskObj.optString("time", "08:00"), taskObj.optString("repeat", "daily"), now);
                try {
                    taskObj.put("nextRunAt", newNext);
                    prefs.edit().putString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, tasksArr.toString()).commit();
                } catch (Exception ignored) {}
                continue;
            }

            Long jsClaimExpiry = jsClaimedTasks.get(taskId);
            if (jsClaimExpiry != null && jsClaimExpiry > now) {
                continue;
            }

            if (!nativeRunningTaskIds.add(taskId)) {
                continue;
            }

            String scheduleId = taskObj.optString("scheduleId", taskId).trim();
            if (scheduleId.isEmpty()) scheduleId = taskId;
            String taskName = taskObj.optString("name", "排程任務");
            String prompt = taskObj.optString("prompt", "執行排程任務");
            String timeStr = taskObj.optString("time", "08:00");
            String repeat = taskObj.optString("repeat", "daily");
            String providerId = taskObj.optString("providerId", "nvidia");
            String modelId = taskObj.optString("modelId", "nvidia/nemotron-3.5-super-vl-120b-a12b");
            String baseUrl = taskObj.optString("baseUrl", "https://integrate.api.nvidia.com/v1");
            String apiKey = taskObj.optString("apiKey", "");
            String systemPrompt = taskObj.optString("systemPrompt", "你是一個專業且守時的 AI 助手。");
            if (!systemPrompt.contains("<widget-summary>")) {
                systemPrompt += "\n\n請在完整回覆最後附上 <widget-summary>10～30個中文字內的核心結論摘要</widget-summary>。";
            }
            JSONArray skillIds = taskObj.optJSONArray("skillIds");

            long startedAt = System.currentTimeMillis();
            String runId = "run_" + scheduleId + "_" + startedAt;
            long advancedNextRun = "once".equals(repeat) ? 0L : calculateNextRunTimeMs(timeStr, repeat, startedAt);

            backgroundWorkStarted(ctx, "正在背景執行排程：" + taskName);

            try {
                // Atomic advance in native sync prefs before running network call
                taskObj.put("lastRunAt", startedAt);
                if ("once".equals(repeat)) {
                    taskObj.put("enabled", false);
                    taskObj.put("nextRunAt", JSONObject.NULL);
                } else {
                    taskObj.put("nextRunAt", advancedNextRun);
                }
                prefs.edit().putString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, tasksArr.toString()).commit();
                ScheduleAlarmReceiver.scheduleNextAlarm(ctx);

                // Show running status on widget
                updateWidgetTaskStatus(ctx, scheduleId, runId, taskName, "⏳ 正在背景執行排程分析中…", null, "running", timeStr, startedAt, startedAt);

                String convId = "conv_task_" + scheduleId + "_" + startedAt;
                String finalContent;
                boolean isFailed = false;

                if (apiKey.trim().isEmpty() && !"ollama".equalsIgnoreCase(providerId)) {
                    isFailed = true;
                    finalContent = "[排程執行錯誤]: 尚未設定 API Key，請開啟 App 至設定填寫後再試。";
                } else {
                    String[] resultPair = callChatCompletions(baseUrl, apiKey, modelId, systemPrompt, prompt);
                    finalContent = resultPair[0];
                    isFailed = "true".equals(resultPair[1]);
                }

                long completedAt = System.currentTimeMillis();
                if (!isFailed && finalContent != null) {
                    String withoutThinkCheck = finalContent
                            .replaceAll("(?si)<think>[\\s\\S]*?</think>", "")
                            .replaceAll("(?si)<think>[\\s\\S]*", "")
                            .trim();
                    if (withoutThinkCheck.isEmpty() && finalContent.matches("(?si).*<think>.*")) {
                        finalContent = finalContent.replaceAll("(?i)</?think>", "").trim();
                    }
                }
                String cleanedSummary = extractWidgetSummary(finalContent, isFailed);
                String storedContent = isFailed ? finalContent : stripWidgetSummaryTag(finalContent);
                if (storedContent.isEmpty()) {
                    storedContent = cleanedSummary;
                }

                // Append to pending_native_task_results so JS LocalDB imports it automatically
                JSONArray pendingArr;
                try {
                    String existingPending = prefs.getString(KEY_PENDING_NATIVE_RESULTS, "[]");
                    pendingArr = new JSONArray(existingPending != null && !existingPending.isEmpty() ? existingPending : "[]");
                } catch (Exception e) {
                    pendingArr = new JSONArray();
                }

                JSONObject record = new JSONObject();
                record.put("scheduleId", scheduleId);
                record.put("taskId", scheduleId);
                record.put("runId", runId);
                record.put("taskName", taskName);
                record.put("prompt", prompt);
                record.put("conversationId", convId);
                record.put("userMsgId", "msg_task_u_" + startedAt);
                record.put("assistantMsgId", "msg_task_a_" + completedAt);
                record.put("content", storedContent);
                record.put("summary", cleanedSummary);
                record.put("executedAt", startedAt);
                record.put("startedAt", startedAt);
                record.put("completedAt", completedAt);
                record.put("isFailed", isFailed);
                record.put("nextRunAt", advancedNextRun > 0 ? advancedNextRun : JSONObject.NULL);
                record.put("repeat", repeat);
                record.put("skillIds", skillIds != null ? skillIds : new JSONArray().put("daily-fortune"));
                record.put("providerId", providerId);
                record.put("modelId", modelId);
                pendingArr.put(record);

                // Update native sync conversationId too
                taskObj.put("conversationId", convId);
                prefs.edit()
                        .putString(KEY_PENDING_NATIVE_RESULTS, pendingArr.toString())
                        .putString(ScheduleAlarmReceiver.KEY_NATIVE_TASKS_SYNC, tasksArr.toString())
                        .commit();

                updateWidgetTaskStatus(
                        ctx,
                        scheduleId,
                        runId,
                        taskName,
                        cleanedSummary,
                        convId,
                        isFailed ? "failed" : "success",
                        timeStr,
                        startedAt,
                        completedAt
                );

                String notifTitle = (isFailed ? "⚠️ 排程執行失敗：" : "✅ 排程完成：") + taskName;
                showTaskCompletionNotification(ctx, notifTitle, cleanedSummary, convId, scheduleId, isFailed);
                MainActivity.notifyNativeTaskCompletedToWebView();
            } catch (Exception e) {
                Log.w(TAG, "Native scheduled task execution failed: " + e.getMessage());
            } finally {
                nativeRunningTaskIds.remove(taskId);
                backgroundWorkFinished(ctx);
            }
        }
    }

    private static String[] callChatCompletions(String baseUrl, String apiKey, String modelId, String systemPrompt, String prompt) {
        final int[] tokenTiers = new int[]{32768, 16384, 8192, 4096};
        String cleanBase = (baseUrl != null && !baseUrl.trim().isEmpty())
                ? baseUrl.trim().replaceAll("/+$", "")
                : "https://integrate.api.nvidia.com/v1";

        for (int i = 0; i < tokenTiers.length; i++) {
            int maxTokens = tokenTiers[i];
            HttpURLConnection conn = null;
            try {
                URL url = new URL(cleanBase + "/chat/completions");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoInput(true);
                conn.setDoOutput(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(180000);
                conn.setUseCaches(false);
                conn.setRequestProperty("Connection", "close");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json, text/event-stream");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android; Mobile) NvidiaPatchChat/1.0");
                if (apiKey != null && !apiKey.trim().isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                }

                JSONObject body = new JSONObject();
                body.put("model", modelId != null && !modelId.trim().isEmpty() ? modelId : "nvidia/nemotron-3.5-super-vl-120b-a12b");
                JSONArray msgs = new JSONArray();
                JSONObject sysMsg = new JSONObject();
                sysMsg.put("role", "system");
                sysMsg.put("content", systemPrompt);
                msgs.put(sysMsg);
                JSONObject usrMsg = new JSONObject();
                usrMsg.put("role", "user");
                usrMsg.put("content", prompt);
                msgs.put(usrMsg);
                body.put("messages", msgs);
                body.put("temperature", 0.7);
                body.put("max_tokens", maxTokens);
                body.put("stream", false);

                byte[] outBytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(outBytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(outBytes);
                    os.flush();
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (is != null) {
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line).append('\n');
                        }
                    }
                }
                String rawResp = sb.toString().trim();

                if (code < 200 || code >= 300) {
                    if ((code == 400 || code == 422) && i < tokenTiers.length - 1) {
                        String lowerErr = rawResp.toLowerCase(Locale.ROOT);
                        boolean isNonTokenError = lowerErr.contains("api key")
                                || lowerErr.contains("unauthorized")
                                || lowerErr.contains("model not found");
                        if (!isNonTokenError) {
                            Log.d(TAG, "Scheduled task HTTP " + code + " with max_tokens=" + maxTokens + ", stepping down to " + tokenTiers[i + 1]);
                            continue;
                        }
                    }
                    return new String[]{"[排程執行錯誤]: HTTP " + code + " " + rawResp, "true"};
                }

                if (rawResp.startsWith("data:")) {
                    // Handle SSE fallback if server ignored stream:false
                    StringBuilder sseText = new StringBuilder();
                    StringBuilder sseReasoning = new StringBuilder();
                    String[] lines = rawResp.split("\\n");
                    for (String l : lines) {
                        String t = l.trim();
                        if (!t.startsWith("data:")) continue;
                        String payload = t.substring(5).trim();
                        if ("[DONE]".equals(payload)) break;
                        try {
                            JSONObject chunk = new JSONObject(payload);
                            JSONArray choices = chunk.optJSONArray("choices");
                            if (choices != null && choices.length() > 0) {
                                JSONObject delta = choices.getJSONObject(0).optJSONObject("delta");
                                if (delta != null) {
                                    if (delta.has("content") && !delta.isNull("content")) {
                                        sseText.append(delta.optString("content", ""));
                                    }
                                    if (delta.has("reasoning_content") && !delta.isNull("reasoning_content")) {
                                        sseReasoning.append(delta.optString("reasoning_content", ""));
                                    }
                                }
                            }
                        } catch (Exception ignored) {}
                    }
                    String out = sseText.toString().trim();
                    if (!out.isEmpty()) {
                        return new String[]{out, "false"};
                    }
                    String outReasoning = sseReasoning.toString().trim();
                    if (!outReasoning.isEmpty()) {
                        return new String[]{outReasoning, "false"};
                    }
                    return new String[]{"[排程執行結果為空]", "true"};
                }

                JSONObject respJson = new JSONObject(rawResp);
                JSONArray choices = respJson.optJSONArray("choices");
                if (choices != null && choices.length() > 0) {
                    JSONObject first = choices.getJSONObject(0);
                    JSONObject msg = first.optJSONObject("message");
                    if (msg != null) {
                        String content = !msg.isNull("content") ? msg.optString("content", "").trim() : "";
                        if (!content.isEmpty()) {
                            return new String[]{content, "false"};
                        }
                        String reasoning = !msg.isNull("reasoning_content") ? msg.optString("reasoning_content", "").trim() : "";
                        if (!reasoning.isEmpty()) {
                            return new String[]{reasoning, "false"};
                        }
                        String reasoningAlt = !msg.isNull("reasoning") ? msg.optString("reasoning", "").trim() : "";
                        if (!reasoningAlt.isEmpty()) {
                            return new String[]{reasoningAlt, "false"};
                        }
                    }
                }
                return new String[]{"[排程執行結果為空]", "true"};
            } catch (Exception e) {
                return new String[]{"[排程執行錯誤]: " + (e.getMessage() != null ? e.getMessage() : "網路連線異常"), "true"};
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }
        return new String[]{"[排程執行結果為空]", "true"};
    }

    private static void updateWidgetTaskStatus(
            Context ctx,
            String scheduleId,
            String runId,
            String title,
            String summary,
            String conversationId,
            String status,
            String timeStr,
            long executedAt,
            long updatedAt
    ) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String rawList = prefs.getString(KEY_WIDGET_TASKS_LIST, "[]");
            JSONArray arr = new JSONArray(rawList != null && !rawList.isEmpty() ? rawList : "[]");

            JSONObject updatedEntry = null;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item != null) {
                    String itemId = item.optString("scheduleId", "").trim();
                    if (itemId.isEmpty()) itemId = item.optString("taskId", "").trim();
                    if (scheduleId.equals(itemId)) {
                        long existingExecutedAt = item.optLong("executedAt", 0L);
                        if (existingExecutedAt > executedAt && !"running".equals(status)) {
                            // Do not allow older async completion to overwrite newer execution
                            return;
                        }
                        item.put("scheduleId", scheduleId);
                        item.put("taskId", scheduleId);
                        if (runId != null) item.put("runId", runId);
                        item.put("title", title);
                        item.put("summary", summary);
                        item.put("lastRunStatus", status);
                        item.put("executedAt", executedAt);
                        item.put("updatedAt", updatedAt);
                        if (timeStr != null) item.put("time", timeStr);
                        if (conversationId != null) item.put("conversationId", conversationId);
                        updatedEntry = item;
                        break;
                    }
                }
            }

            if (updatedEntry == null) {
                updatedEntry = new JSONObject();
                updatedEntry.put("scheduleId", scheduleId);
                updatedEntry.put("taskId", scheduleId);
                if (runId != null) updatedEntry.put("runId", runId);
                updatedEntry.put("title", title);
                updatedEntry.put("summary", summary);
                updatedEntry.put("lastRunStatus", status);
                updatedEntry.put("executedAt", executedAt);
                updatedEntry.put("updatedAt", updatedAt);
                if (timeStr != null) updatedEntry.put("time", timeStr);
                if (conversationId != null) updatedEntry.put("conversationId", conversationId);
                arr.put(updatedEntry);
            }

            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_WIDGET_TASKS_LIST, arr.toString());

            String selectedId = prefs.getString(KEY_WIDGET_SELECTED_TASK_ID, "");
            if (selectedId == null || selectedId.trim().isEmpty() || selectedId.equals(scheduleId)) {
                editor.putString(KEY_WIDGET_SELECTED_TASK_ID, scheduleId);
                editor.putString(KEY_WIDGET_LATEST_TASK, updatedEntry.toString());
            }
            editor.commit();
            TaskWidgetProvider.refreshAllWidgets(ctx);
        } catch (Exception e) {
            Log.w(TAG, "updateWidgetTaskStatus failed: " + e.getMessage());
        }
    }

    public static void showTaskCompletionNotification(
            Context context,
            String title,
            String body,
            String conversationId,
            String taskId,
            boolean isError
    ) {
        if (context == null) return;
        Context ctx = context.getApplicationContext();

        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        RESULT_CHANNEL_ID,
                        "排程與分析結果通知",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("排程任務與背景對話執行完成或失敗通知");
                channel.enableVibration(true);
                nm.createNotificationChannel(channel);
            }

            String cleanConvId = (conversationId != null && !conversationId.trim().isEmpty()
                    && !"null".equalsIgnoreCase(conversationId.trim())
                    && !"undefined".equalsIgnoreCase(conversationId.trim()))
                    ? conversationId.trim() : null;
            String cleanTaskId = (taskId != null && !taskId.trim().isEmpty()
                    && !"null".equalsIgnoreCase(taskId.trim())
                    && !"undefined".equalsIgnoreCase(taskId.trim()))
                    ? taskId.trim() : null;

            String cleanTitle = (title != null && !title.trim().isEmpty())
                    ? title.trim()
                    : (isError ? "⚠️ 排程執行失敗" : "✅ 排程任務已完成");
            String cleanBody = cleanSummaryForDisplay(body != null ? body : "").replace('\n', ' ').trim();
            if (cleanBody.length() > 140) {
                cleanBody = cleanBody.substring(0, 140) + "…";
            }
            if (cleanBody.isEmpty()) {
                cleanBody = isError ? "點擊查看錯誤詳情" : "點擊查看完整分析結果";
            }

            Intent intent = new Intent(ctx, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("navSource", "notification");
            if (cleanConvId != null) {
                intent.putExtra("conversationId", cleanConvId);
            }
            if (cleanTaskId != null) {
                intent.putExtra("taskId", cleanTaskId);
            }
            String uriStr = "nvidiapatch://notification/"
                    + Uri.encode(cleanTaskId != null ? cleanTaskId : "none")
                    + "/"
                    + Uri.encode(cleanConvId != null ? cleanConvId : "none")
                    + "?t=" + System.currentTimeMillis();
            intent.setData(Uri.parse(uriStr));

            int notifId = (int) ((System.currentTimeMillis() & 0x7FFFFFFFL) % 1000000L) + 2000;
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(ctx, notifId, intent, piFlags);

            Notification notification = new NotificationCompat.Builder(ctx, RESULT_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(cleanTitle)
                    .setContentText(cleanBody)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(cleanBody))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .build();

            nm.notify(notifId, notification);
        } catch (SecurityException se) {
            Log.w(TAG, "Notification permission denied: " + se.getMessage());
        } catch (Exception e) {
            Log.w(TAG, "showTaskCompletionNotification failed: " + e.getMessage());
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        synchronized (lock) {
            running = true;
            if (handler == null) handler = new Handler(Looper.getMainLooper());
            appContext = getApplicationContext();
            handler.removeCallbacks(stopRunnable);
        }
        startForegroundCompat();
        acquireWakeLock();

        if (intent != null && ACTION_RUN_SCHEDULED_ALARM.equals(intent.getAction())) {
            final Context ctx = getApplicationContext();
            alarmExecutor.submit(() -> {
                try {
                    handleAlarmExecution(ctx);
                } finally {
                    backgroundWorkFinished(ctx);
                }
            });
        } else {
            synchronized (lock) {
                if (activeStreams == 0 && backgroundTasks == 0 && handler != null) {
                    handler.postDelayed(stopRunnable, STOP_DELAY_MS);
                }
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        synchronized (lock) {
            if (handler != null) handler.removeCallbacks(stopRunnable);
            handler = null;
            running = false;
            appContext = null;
        }
        releaseWakeLock();
        super.onDestroy();
    }

    private void startForegroundCompat() {
        Notification notification = buildOngoingNotification(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                return;
            } catch (Exception e) {
                Log.d(TAG, "typed startForeground failed: " + e.getMessage());
            }
        }
        try {
            startForeground(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.d(TAG, "startForeground failed: " + e.getMessage());
        }
    }

    private void acquireWakeLock() {
        synchronized (StreamForegroundService.class) {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NvidiaPatch:llm_stream");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
    }

    private static void releaseWakeLock() {
        synchronized (StreamForegroundService.class) {
            if (wakeLock != null) {
                try {
                    if (wakeLock.isHeld()) wakeLock.release();
                } catch (Exception ignored) {}
                wakeLock = null;
            }
        }
    }

    private static Notification buildOngoingNotification(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "AI 背景服務", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(channel);
            }
        }
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 1001, intent, piFlags);
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(currentNotificationText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build();
    }
}
