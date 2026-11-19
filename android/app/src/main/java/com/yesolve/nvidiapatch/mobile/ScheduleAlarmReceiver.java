package com.yesolve.nvidiapatch.mobile;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

public class ScheduleAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "NvidiaPatch";
    private static final String PREFS_NAME = "CapacitorStorage";
    public static final String KEY_NATIVE_TASKS_SYNC = "native_scheduled_tasks_sync";
    public static final String ACTION_EXECUTE_SCHEDULED_TASK = "com.yesolve.nvidiapatch.ACTION_EXECUTE_SCHEDULED_TASK";
    private static final int ALARM_REQUEST_CODE = 4001;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        Log.d(TAG, "ScheduleAlarmReceiver onReceive: " + action);

        if (ACTION_EXECUTE_SCHEDULED_TASK.equals(action)) {
            StreamForegroundService.onScheduleAlarmTriggered(context.getApplicationContext());
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            scheduleNextAlarm(context.getApplicationContext());
        }
    }

    public static void scheduleNextAlarm(Context context) {
        if (context == null) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent alarmIntent = new Intent(context, ScheduleAlarmReceiver.class);
        alarmIntent.setAction(ACTION_EXECUTE_SCHEDULED_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, alarmIntent, flags);
        am.cancel(pi);

        long earliestRunAt = Long.MAX_VALUE;
        long now = System.currentTimeMillis();

        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_NATIVE_TASKS_SYNC, null);
            if (raw != null && !raw.trim().isEmpty()) {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.optJSONObject(i);
                    if (obj == null) continue;
                    boolean enabled = obj.optBoolean("enabled", false);
                    long nextRunAt = obj.optLong("nextRunAt", 0L);
                    if (enabled && nextRunAt > 0L) {
                        // Only schedule alarms that are either upcoming or recently due (< 4 hours)
                        if (nextRunAt > now - (4L * 3600L * 1000L) && nextRunAt < earliestRunAt) {
                            earliestRunAt = nextRunAt;
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "scheduleNextAlarm parse failed: " + e.getMessage());
        }

        if (earliestRunAt == Long.MAX_VALUE) {
            Log.d(TAG, "No enabled scheduled tasks for AlarmManager");
            return;
        }

        long triggerAt = Math.max(earliestRunAt, now + 1000L);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            Log.d(TAG, "Scheduled native alarm at " + triggerAt + " (in " + ((triggerAt - now) / 1000) + "s)");
        } catch (SecurityException se) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } catch (Exception ignored) {}
        } catch (Exception e) {
            Log.w(TAG, "Failed to schedule alarm: " + e.getMessage());
        }
    }
}
