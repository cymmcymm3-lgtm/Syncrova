package com.nemsu.studenthub;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class SyncrovaMessagingService extends FirebaseMessagingService {
    static final String CHANNEL_ID = "syncrova_messages";
    static final String REPLY_KEY = "syncrova_reply_text";
    static final String EXTRA_SENDER_ID = "senderId";
    static final String EXTRA_NOTIFICATION_ID = "notificationId";
    static final String EXTRA_HREF = "href";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token == null ? "" : token)
            .apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        RemoteMessage.Notification notification = remoteMessage.getNotification();

        String title = valueOr(data.get("title"), notification == null ? "" : notification.getTitle(), "Syncrova");
        String body = valueOr(data.get("body"), notification == null ? "" : notification.getBody(), "New notification");
        String type = valueOr(data.get("type"), "", "notification");
        String senderId = valueOr(data.get("senderId"), data.get("from"), data.get("actorId"));
        String href = valueOr(data.get("href"), senderId.isEmpty() ? "/messages" : "/messages?user=" + senderId, "/messages");
        String messageId = valueOr(data.get("messageId"), data.get("notificationId"), String.valueOf(System.currentTimeMillis()));
        String actorAvatar = valueOr(data.get("actorAvatar"), "", "");

        showMessageNotification(title, body, type, senderId, href, messageId);
        if ("message".equals(type) && !senderId.isEmpty()) {
            SyncrovaChatHeadService.show(this, title, body, senderId, href, actorAvatar);
        }
    }

    private void showMessageNotification(String title, String body, String type, String senderId, String href, String messageId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        ensureChannel(this);

        int notificationId = getNotificationId(messageId, senderId);
        Intent openIntent = new Intent(Intent.ACTION_VIEW, buildDeepLink(href), this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra(EXTRA_HREF, href);

        PendingIntent openPendingIntent = PendingIntent.getActivity(
            this,
            notificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent replyIntent = new Intent(this, SyncrovaNotificationReplyReceiver.class);
        replyIntent.putExtra(EXTRA_SENDER_ID, senderId);
        replyIntent.putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        replyIntent.putExtra(EXTRA_HREF, href);

        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
            this,
            notificationId + 1000,
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );

        RemoteInput remoteInput = new RemoteInput.Builder(REPLY_KEY)
            .setLabel("Reply to " + title)
            .build();

        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
            R.drawable.ic_syncrova_notification,
            "Reply",
            replyPendingIntent
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(true)
            .build();

        Bitmap largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_syncrova_notification)
            .setColor(Color.parseColor("#0B74FF"))
            .setLargeIcon(largeIcon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openPendingIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(senderId.isEmpty() ? "syncrova_messages" : "syncrova_messages_" + senderId);

        if ("message".equals(type) && !senderId.isEmpty()) {
            builder.addAction(replyAction);
        }

        NotificationManagerCompat.from(this).notify(notificationId, builder.build());
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("New Syncrova chat messages");
        channel.enableLights(true);
        channel.setLightColor(Color.parseColor("#0B74FF"));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    static int getNotificationId(String messageId, String senderId) {
        String key = valueOr(messageId, senderId, String.valueOf(System.currentTimeMillis()));
        int hash = key.hashCode();
        if (hash == Integer.MIN_VALUE) return 1001;
        return Math.abs(hash);
    }

    static Uri buildDeepLink(String href) {
        String safeHref = valueOr(href, "/messages", "/messages");
        if (!safeHref.startsWith("/")) safeHref = "/" + safeHref;
        return Uri.parse("syncrova://open" + safeHref);
    }

    static String valueOr(String first, String second, String fallback) {
        if (first != null && !first.trim().isEmpty()) return first.trim();
        if (second != null && !second.trim().isEmpty()) return second.trim();
        return fallback == null ? "" : fallback;
    }
}
