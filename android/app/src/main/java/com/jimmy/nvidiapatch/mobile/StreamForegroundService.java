package com.jimmy.nvidiapatch.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class StreamForegroundService extends Service {
    private static final String TAG = "NvidiaPatch";
    private static final String CHANNEL_ID = "llm_stream_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final long STOP_DELAY_MS = 5000L; // Stop service 5s after completion
    private static final long WAKE_LOCK_TIMEOUT_MS = 10L * 60 * 1000; // Strict 10-minute safety cap

    private static final Object lock = new Object();
    private static int activeStreams = 0;
    private static int backgroundTasks = 0;
    private static boolean running = false;
    private static Handler handler;
    private static Context appContext;
    private static PowerManager.WakeLock wakeLock;
    private static String currentNotificationText = "正在背景維持 AI 服務…";

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
        boolean needStart;
        synchronized (lock) {
            if (handler != null) handler.removeCallbacks(stopRunnable);
            needStart = !running;
            if (needStart) appContext = context.getApplicationContext();
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
        }
    }

    public static void streamStarted(Context context) {
        synchronized (lock) {
            activeStreams++;
            currentNotificationText = "正在背景接收 AI 回應…";
        }
        ensureServiceStarted(context);
    }

    public static void streamFinished(Context context) {
        synchronized (lock) {
            if (activeStreams > 0) activeStreams--;
            if (activeStreams == 0 && backgroundTasks == 0) {
                releaseWakeLock(); // Release CPU wake lock immediately to protect battery
                if (running && handler != null) {
                    handler.postDelayed(stopRunnable, STOP_DELAY_MS);
                }
            }
        }
    }

    public static void backgroundWorkStarted(Context context, String reason) {
        synchronized (lock) {
            backgroundTasks++;
            currentNotificationText = "正在背景執行任務排程…";
        }
        ensureServiceStarted(context);
    }

    public static void backgroundWorkFinished(Context context) {
        synchronized (lock) {
            if (backgroundTasks > 0) backgroundTasks--;
            if (activeStreams == 0 && backgroundTasks == 0) {
                releaseWakeLock(); // Release CPU wake lock immediately to protect battery
                if (running && handler != null) {
                    handler.postDelayed(stopRunnable, STOP_DELAY_MS);
                }
            }
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
        synchronized (lock) {
            if (activeStreams == 0 && backgroundTasks == 0) {
                handler.postDelayed(stopRunnable, STOP_DELAY_MS);
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
        Notification notification = buildNotification();
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

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "AI 背景服務", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(channel);
            }
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(currentNotificationText)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build();
    }
}
