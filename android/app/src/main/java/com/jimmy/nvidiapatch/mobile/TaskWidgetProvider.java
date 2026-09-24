package com.jimmy.nvidiapatch.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class TaskWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String KEY_WIDGET_LATEST_TASK = "widget_latest_task";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task_layout);

        String title = "每日排程運勢";
        String summary = "點擊開啟 NvidiaPatch 查看最新排程分析與今日運勢簡報。";
        String timeStr = "";
        String conversationId = null;

        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String rawJson = prefs.getString(KEY_WIDGET_LATEST_TASK, null);

            if (rawJson != null && !rawJson.isEmpty()) {
                JSONObject obj = new JSONObject(rawJson);
                if (obj.has("title")) title = obj.getString("title");
                if (obj.has("summary")) summary = obj.getString("summary");
                if (obj.has("conversationId")) conversationId = obj.getString("conversationId");
                if (obj.has("updatedAt")) {
                    long updatedAt = obj.getLong("updatedAt");
                    SimpleDateFormat sdf = new SimpleDateFormat("HH:mm", Locale.getDefault());
                    timeStr = sdf.format(new Date(updatedAt));
                }
            }
        } catch (Exception ignored) {}

        views.setTextViewText(R.id.widget_task_title, title);
        views.setTextViewText(R.id.widget_task_summary, summary);
        if (!timeStr.isEmpty()) {
            views.setTextViewText(R.id.widget_task_time, timeStr);
        }

        // Click on widget opens MainActivity and selects the conversation if present
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (conversationId != null) {
            intent.putExtra("conversationId", conversationId);
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
        views.setOnClickPendingIntent(R.id.widget_container, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        // When receiving widget update broadcast, refresh all widgets
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName thisAppWidget = new ComponentName(context.getPackageName(), TaskWidgetProvider.class.getName());
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisAppWidget);
        if (appWidgetIds != null && appWidgetIds.length > 0) {
            onUpdate(context, appWidgetManager, appWidgetIds);
        }
    }
}
