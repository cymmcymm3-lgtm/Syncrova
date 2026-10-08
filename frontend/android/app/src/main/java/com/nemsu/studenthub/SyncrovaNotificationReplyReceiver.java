package com.nemsu.studenthub;

import android.Manifest;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SyncrovaNotificationReplyReceiver extends BroadcastReceiver {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pendingResult = goAsync();
        EXECUTOR.execute(() -> {
            try {
                handleReply(context, intent);
            } finally {
                pendingResult.finish();
            }
        });
    }

    private void handleReply(Context context, Intent intent) {
        Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
        String text = remoteInput == null ? "" : String.valueOf(remoteInput.getCharSequence(SyncrovaMessagingService.REPLY_KEY, "")).trim();
        String to = intent.getStringExtra(SyncrovaMessagingService.EXTRA_SENDER_ID);
        int notificationId = intent.getIntExtra(SyncrovaMessagingService.EXTRA_NOTIFICATION_ID, 0);
        String href = intent.getStringExtra(SyncrovaMessagingService.EXTRA_HREF);

        if (text.isEmpty() || to == null || to.trim().isEmpty()) {
            showStatus(context, "Reply not sent", "Open Syncrova and try again.", notificationId, href);
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String token = prefs.getString(SyncrovaNativeBridgePlugin.AUTH_TOKEN_KEY, "");
        String apiBaseUrl = prefs.getString(SyncrovaNativeBridgePlugin.API_BASE_URL_KEY, "");
        if (apiBaseUrl == null || apiBaseUrl.trim().isEmpty()) {
            apiBaseUrl = context.getString(R.string.syncrova_api_base_url);
        }

        if (token == null || token.trim().isEmpty()) {
            showStatus(context, "Reply not sent", "Open Syncrova once to reconnect notifications.", notificationId, href);
            return;
        }

        boolean sent = postReply(apiBaseUrl, token, to.trim(), text);
        if (notificationId > 0) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(notificationId);
        }

        if (sent) {
            showStatus(context, "Reply sent", text, notificationId + 2000, href);
        } else {
            showStatus(context, "Reply failed", "Open Syncrova and send again.", notificationId + 3000, href);
        }
    }

    private boolean postReply(String apiBaseUrl, String token, String to, String text) {
        HttpURLConnection connection = null;
        try {
            String base = apiBaseUrl.replaceAll("/+$", "");
            URL url = new URL(base + "/messages");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("x-auth-token", token);

            String body = "{\"to\":\"" + jsonEscape(to) + "\",\"text\":\"" + jsonEscape(text) + "\"}";
            try (OutputStream outputStream = connection.getOutputStream()) {
                outputStream.write(body.getBytes(StandardCharsets.UTF_8));
            }

            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showStatus(Context context, String title, String body, int notificationId, String href) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        SyncrovaMessagingService.ensureChannel(context);

        Intent openIntent = new Intent(Intent.ACTION_VIEW, SyncrovaMessagingService.buildDeepLink(href), context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            Math.max(1, notificationId),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, SyncrovaMessagingService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_syncrova_notification)
            .setColor(Color.parseColor("#0B74FF"))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(Math.max(1, notificationId), builder.build());
    }

    private String jsonEscape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }
}
