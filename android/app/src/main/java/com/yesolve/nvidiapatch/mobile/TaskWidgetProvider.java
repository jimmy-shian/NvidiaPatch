package com.yesolve.nvidiapatch.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class TaskWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String KEY_WIDGET_LATEST_TASK = "widget_latest_task";
    private static final String KEY_WIDGET_TASKS_LIST = "widget_tasks_list";
    private static final String KEY_WIDGET_SELECTED_TASK_ID = "widget_selected_task_id";

    public static final String ACTION_WIDGET_PREV_TASK = "com.yesolve.nvidiapatch.ACTION_WIDGET_PREV_TASK";
    public static final String ACTION_WIDGET_NEXT_TASK = "com.yesolve.nvidiapatch.ACTION_WIDGET_NEXT_TASK";

    private static String optCleanString(JSONObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.isNull(key)) return null;
        String val = obj.optString(key, "").trim();
        if (val.isEmpty() || "null".equalsIgnoreCase(val) || "undefined".equalsIgnoreCase(val)) {
            return null;
        }
        return val;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task_layout);

        String title = "每日排程運勢";
        String summary = "點擊開啟 NvidiaPatch 設定排程分析。";
        String timeStr = "未排程";
        String conversationId = null;
        String taskId = null;
        String lastRunStatus = null;
        String indexStr = "0/0";
        int totalTasks = 0;

        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String rawList = prefs.getString(KEY_WIDGET_TASKS_LIST, null);
            String selectedId = prefs.getString(KEY_WIDGET_SELECTED_TASK_ID, null);
            if (selectedId != null) {
                selectedId = selectedId.trim();
                if (selectedId.isEmpty() || "null".equalsIgnoreCase(selectedId) || "undefined".equalsIgnoreCase(selectedId)) {
                    selectedId = null;
                }
            }

            JSONObject chosenObj = null;
            if (rawList != null && !rawList.trim().isEmpty()) {
                JSONArray arr = new JSONArray(rawList);
                totalTasks = arr.length();
                if (totalTasks > 0) {
                    int chosenIdx = 0;
                    if (selectedId != null) {
                        for (int i = 0; i < totalTasks; i++) {
                            JSONObject item = arr.optJSONObject(i);
                            String itemId = optCleanString(item, "scheduleId");
                            if (itemId == null) itemId = optCleanString(item, "taskId");
                            if (selectedId.equals(itemId)) {
                                chosenIdx = i;
                                break;
                            }
                        }
                    }
                    chosenObj = arr.optJSONObject(chosenIdx);
                    indexStr = (chosenIdx + 1) + "/" + totalTasks;
                }
            }

            if (chosenObj == null) {
                String rawJson = prefs.getString(KEY_WIDGET_LATEST_TASK, null);
                if (rawJson != null && !rawJson.trim().isEmpty()) {
                    chosenObj = new JSONObject(rawJson);
                    String fallbackId = optCleanString(chosenObj, "scheduleId");
                    if (fallbackId == null) fallbackId = optCleanString(chosenObj, "taskId");
                    if (fallbackId != null) {
                        indexStr = "1/1";
                        totalTasks = 1;
                    }
                }
            }

            if (chosenObj != null) {
                String t = optCleanString(chosenObj, "title");
                if (t != null) title = t;
                String s = optCleanString(chosenObj, "summary");
                if (s != null) summary = s;
                conversationId = optCleanString(chosenObj, "conversationId");
                taskId = optCleanString(chosenObj, "scheduleId");
                if (taskId == null) taskId = optCleanString(chosenObj, "taskId");
                lastRunStatus = optCleanString(chosenObj, "lastRunStatus");
                String scheduledTime = optCleanString(chosenObj, "time");

                if ("running".equals(lastRunStatus)) {
                    timeStr = "執行中…";
                } else if ("failed".equals(lastRunStatus)) {
                    timeStr = scheduledTime != null ? ("失敗 · " + scheduledTime) : "執行失敗";
                    if (!summary.startsWith("⚠️") && !summary.contains("失敗")) {
                        summary = "⚠️ 失敗：" + summary;
                    }
                } else if (chosenObj.has("updatedAt") && chosenObj.optLong("updatedAt", 0) > 0 && conversationId != null) {
                    long updatedAt = chosenObj.optLong("updatedAt", 0);
                    SimpleDateFormat sdf = new SimpleDateFormat("HH:mm", Locale.getDefault());
                    timeStr = sdf.format(new Date(updatedAt));
                } else if (scheduledTime != null) {
                    timeStr = "⏰ " + scheduledTime;
                }
            }
        } catch (Exception ignored) {}

        views.setTextViewText(R.id.widget_task_title, title);
        views.setTextViewText(R.id.widget_task_summary, summary);
        views.setTextViewText(R.id.widget_task_time, timeStr);
        views.setTextViewText(R.id.widget_task_index, indexStr);

        int navVisibility = totalTasks > 1 ? View.VISIBLE : View.GONE;
        views.setViewVisibility(R.id.widget_btn_prev, navVisibility);
        views.setViewVisibility(R.id.widget_task_index, navVisibility);
        views.setViewVisibility(R.id.widget_btn_next, navVisibility);

        String footerText;
        if ("running".equals(lastRunStatus)) {
            footerText = "NvidiaPatch · 正在背景執行排程";
        } else if ("failed".equals(lastRunStatus)) {
            footerText = "NvidiaPatch · 點擊查看失敗原因";
        } else if (conversationId != null) {
            footerText = "NvidiaPatch · 點擊查看完整回覆";
        } else if (taskId != null) {
            footerText = "NvidiaPatch · 點擊查看排程";
        } else {
            footerText = "NvidiaPatch · 點擊新增排程";
        }
        views.setTextViewText(R.id.widget_footer, footerText);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // Prev task button
        Intent prevIntent = new Intent(context, TaskWidgetProvider.class);
        prevIntent.setAction(ACTION_WIDGET_PREV_TASK);
        prevIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        PendingIntent prevPi = PendingIntent.getBroadcast(context, 2000 + appWidgetId, prevIntent, pendingFlags);
        views.setOnClickPendingIntent(R.id.widget_btn_prev, prevPi);

        // Next task button
        Intent nextIntent = new Intent(context, TaskWidgetProvider.class);
        nextIntent.setAction(ACTION_WIDGET_NEXT_TASK);
        nextIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        PendingIntent nextPi = PendingIntent.getBroadcast(context, 3000 + appWidgetId, nextIntent, pendingFlags);
        views.setOnClickPendingIntent(R.id.widget_btn_next, nextPi);

        // Click on widget body opens MainActivity and navigates to conversation or schedule tab
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("navSource", "widget");
        if (conversationId != null) {
            intent.putExtra("conversationId", conversationId);
        }
        if (taskId != null) {
            intent.putExtra("taskId", taskId);
        }
        String uriStr = "nvidiapatch://widget/"
                + Uri.encode(taskId != null ? taskId : "none")
                + "/"
                + Uri.encode(conversationId != null ? conversationId : "none")
                + "?w=" + appWidgetId;
        intent.setData(Uri.parse(uriStr));

        PendingIntent pendingIntent = PendingIntent.getActivity(context, appWidgetId * 10 + 1, intent, pendingFlags);
        views.setOnClickPendingIntent(R.id.widget_container, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static void cycleSelectedTask(Context context, int delta) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String rawList = prefs.getString(KEY_WIDGET_TASKS_LIST, null);
            if (rawList == null || rawList.trim().isEmpty()) return;

            JSONArray arr = new JSONArray(rawList);
            int len = arr.length();
            if (len <= 1) return;

            String selectedId = prefs.getString(KEY_WIDGET_SELECTED_TASK_ID, null);
            int currentIdx = 0;
            if (selectedId != null && !selectedId.trim().isEmpty()) {
                for (int i = 0; i < len; i++) {
                    JSONObject item = arr.optJSONObject(i);
                    String itemId = optCleanString(item, "scheduleId");
                    if (itemId == null) itemId = optCleanString(item, "taskId");
                    if (selectedId.equals(itemId)) {
                        currentIdx = i;
                        break;
                    }
                }
            }

            int nextIdx = (currentIdx + delta + len) % len;
            JSONObject nextObj = arr.optJSONObject(nextIdx);
            if (nextObj == null) return;

            String nextTaskId = optCleanString(nextObj, "scheduleId");
            if (nextTaskId == null) nextTaskId = optCleanString(nextObj, "taskId");
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_WIDGET_SELECTED_TASK_ID, nextTaskId != null ? nextTaskId : "");
            editor.putString(KEY_WIDGET_LATEST_TASK, nextObj.toString());
            editor.commit();
        } catch (Exception ignored) {}
    }

    public static void refreshAllWidgets(Context context) {
        if (context == null) return;
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName thisAppWidget = new ComponentName(context.getPackageName(), TaskWidgetProvider.class.getName());
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisAppWidget);
        if (appWidgetIds != null && appWidgetIds.length > 0) {
            for (int appWidgetId : appWidgetIds) {
                updateAppWidget(context, appWidgetManager, appWidgetId);
            }
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_WIDGET_PREV_TASK.equals(action)) {
                cycleSelectedTask(context, -1);
            } else if (ACTION_WIDGET_NEXT_TASK.equals(action)) {
                cycleSelectedTask(context, 1);
            }
        }
        refreshAllWidgets(context);
    }
}
