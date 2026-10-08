package com.nemsu.studenthub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class SyncrovaChatHeadService extends Service {
    private static final String ACTION_SHOW = "com.nemsu.studenthub.chathead.SHOW";
    private static final String ACTION_HIDE = "com.nemsu.studenthub.chathead.HIDE";
    private static final String CHANNEL_ID = "syncrova_chat_heads";
    private static final int FOREGROUND_ID = 7721;
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_SENDER_ID = "senderId";
    private static final String EXTRA_HREF = "href";
    private static final String EXTRA_AVATAR = "avatar";
    private static final String POSITION_X_KEY = "chat_head_x";
    private static final String POSITION_Y_KEY = "chat_head_y";
    private static final String MESSENGER_PACKAGE = "com.nemsu.studenthub.messenger";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private WindowManager.LayoutParams layoutParams;
    private FrameLayout chatHeadView;
    private ImageView avatarView;
    private TextView initialsView;
    private String title = "Syncrova";
    private String body = "New message";
    private String senderId = "";
    private String href = "/messages";

    public static void show(Context context, String title, String body, String senderId, String href, String avatar) {
        if (!isEnabled(context) || !Settings.canDrawOverlays(context)) return;

        Intent intent = new Intent(context, SyncrovaChatHeadService.class);
        intent.setAction(ACTION_SHOW);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_BODY, body);
        intent.putExtra(EXTRA_SENDER_ID, senderId);
        intent.putExtra(EXTRA_HREF, href);
        intent.putExtra(EXTRA_AVATAR, avatar);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void hide(Context context) {
        Intent intent = new Intent(context, SyncrovaChatHeadService.class);
        intent.setAction(ACTION_HIDE);
        context.startService(intent);
    }

    private static boolean isEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(SyncrovaNativeBridgePlugin.CHAT_HEADS_ENABLED_KEY, true);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            removeChatHead();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        title = valueOr(intent == null ? "" : intent.getStringExtra(EXTRA_TITLE), "Syncrova");
        body = valueOr(intent == null ? "" : intent.getStringExtra(EXTRA_BODY), "New message");
        senderId = valueOr(intent == null ? "" : intent.getStringExtra(EXTRA_SENDER_ID), "");
        href = normalizePath(valueOr(intent == null ? "" : intent.getStringExtra(EXTRA_HREF), senderId.isEmpty() ? "/messages" : "/messages?user=" + senderId));
        String avatar = valueOr(intent == null ? "" : intent.getStringExtra(EXTRA_AVATAR), "");

        ensureChannel();
        try {
            startForeground(FOREGROUND_ID, buildForegroundNotification());
        } catch (Exception ignored) {
            // Some OEM builds delay notification permission state. The overlay still stays best-effort.
        }

        showOrUpdateChatHead(avatar);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        removeChatHead();
        super.onDestroy();
    }

    private void showOrUpdateChatHead(String avatar) {
        if (windowManager == null) return;

        if (chatHeadView == null) {
            chatHeadView = createChatHeadView();
            layoutParams = createLayoutParams();
            try {
                windowManager.addView(chatHeadView, layoutParams);
            } catch (Exception ignored) {
                chatHeadView = null;
                return;
            }
        }

        initialsView.setText(getInitials(title));
        avatarView.setImageDrawable(null);
        avatarView.setVisibility(View.GONE);
        initialsView.setVisibility(View.VISIBLE);
        loadAvatar(avatar);
    }

    private FrameLayout createChatHeadView() {
        int size = dp(62);
        int ring = dp(4);
        FrameLayout root = new FrameLayout(this);
        root.setPadding(ring, ring, ring, ring);
        root.setElevation(dp(18));

        GradientDrawable ringBackground = new GradientDrawable();
        ringBackground.setShape(GradientDrawable.OVAL);
        ringBackground.setColors(new int[] { Color.parseColor("#20C66A"), Color.parseColor("#1686FF") });
        root.setBackground(ringBackground);

        avatarView = new ImageView(this);
        avatarView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        avatarView.setVisibility(View.GONE);
        avatarView.setClipToOutline(true);
        avatarView.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });

        initialsView = new TextView(this);
        initialsView.setGravity(Gravity.CENTER);
        initialsView.setTextColor(Color.WHITE);
        initialsView.setTextSize(20);
        initialsView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        GradientDrawable initialsBackground = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] { Color.parseColor("#121826"), Color.parseColor("#0B74FF") }
        );
        initialsBackground.setShape(GradientDrawable.OVAL);
        initialsView.setBackground(initialsBackground);

        FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(size - ring * 2, size - ring * 2, Gravity.CENTER);
        root.addView(avatarView, contentParams);
        root.addView(initialsView, contentParams);
        root.setOnTouchListener(new ChatHeadTouchListener());
        return root;
    }

    private WindowManager.LayoutParams createLayoutParams() {
        SharedPreferences prefs = getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, MODE_PRIVATE);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            dp(62),
            dp(62),
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = prefs.getInt(POSITION_X_KEY, dp(16));
        params.y = prefs.getInt(POSITION_Y_KEY, dp(118));
        return params;
    }

    private Notification buildForegroundNotification() {
        Intent openIntent = buildOpenChatIntent();
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            FOREGROUND_ID,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_syncrova_notification)
            .setColor(Color.parseColor("#0B74FF"))
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private Intent buildOpenChatIntent() {
        String scheme = BuildConfig.SYNCROVA_MESSENGER ? "syncrova-messenger" : "syncrova";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(scheme + "://open" + href));

        if (BuildConfig.SYNCROVA_MESSENGER) {
            intent.setPackage(getPackageName());
        } else if (isPackageInstalled(MESSENGER_PACKAGE)) {
            intent.setData(Uri.parse("syncrova-messenger://open" + href));
            intent.setPackage(MESSENGER_PACKAGE);
        } else {
            intent.setClass(this, MainActivity.class);
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return intent;
    }

    private void openChat() {
        try {
            startActivity(buildOpenChatIntent());
        } catch (Exception ignored) {
            Intent fallback = new Intent(this, MainActivity.class);
            fallback.setAction(Intent.ACTION_VIEW);
            fallback.setData(Uri.parse("syncrova://open" + href));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(fallback);
        }
        removeChatHead();
        stopSelf();
    }

    private void loadAvatar(String avatar) {
        String avatarUrl = resolveAvatarUrl(avatar);
        if (avatarUrl.isEmpty()) return;

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(avatarUrl).openConnection();
                connection.setConnectTimeout(3500);
                connection.setReadTimeout(3500);
                connection.setDoInput(true);
                try (InputStream input = connection.getInputStream()) {
                    Bitmap bitmap = BitmapFactory.decodeStream(input);
                    if (bitmap == null) return;
                    mainHandler.post(() -> {
                        if (avatarView == null || initialsView == null) return;
                        avatarView.setImageBitmap(bitmap);
                        avatarView.setVisibility(View.VISIBLE);
                        initialsView.setVisibility(View.GONE);
                    });
                }
            } catch (Exception ignored) {
                // Initials remain as the fallback chat head.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "syncrova-chat-head-avatar").start();
    }

    private String resolveAvatarUrl(String avatar) {
        String value = valueOr(avatar, "");
        if (value.startsWith("http://") || value.startsWith("https://")) return value;
        if (!value.startsWith("/")) return "";

        String apiBase = getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, MODE_PRIVATE)
            .getString(SyncrovaNativeBridgePlugin.API_BASE_URL_KEY, "");
        if (apiBase == null || apiBase.trim().isEmpty()) return "";

        String origin = apiBase.trim().replaceFirst("/api/?$", "").replaceAll("/+$", "");
        return origin + value;
    }

    private void removeChatHead() {
        if (windowManager == null || chatHeadView == null) return;
        try {
            windowManager.removeView(chatHeadView);
        } catch (Exception ignored) {
            // The window may already be detached.
        }
        chatHeadView = null;
        avatarView = null;
        initialsView = null;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Chat heads",
            NotificationManager.IMPORTANCE_MIN
        );
        channel.setDescription("Keeps Syncrova Messenger chat heads active.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String normalizePath(String value) {
        String safePath = valueOr(value, "/messages");
        if (!safePath.startsWith("/")) safePath = "/" + safePath;
        if (!safePath.startsWith("/messages")) return "/messages";
        return safePath.replaceAll("[\\r\\n]", "");
    }

    private String getInitials(String value) {
        String[] parts = valueOr(value, "S").trim().split("\\s+");
        String first = parts.length > 0 && parts[0].length() > 0 ? parts[0].substring(0, 1) : "S";
        String second = parts.length > 1 && parts[1].length() > 0 ? parts[1].substring(0, 1) : "";
        return (first + second).toUpperCase();
    }

    private String valueOr(String value, String fallback) {
        return value != null && !value.trim().isEmpty() ? value.trim() : fallback;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class ChatHeadTouchListener implements View.OnTouchListener {
        private int initialX;
        private int initialY;
        private float initialTouchX;
        private float initialTouchY;
        private boolean dragging;

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (layoutParams == null || windowManager == null) return false;

            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initialX = layoutParams.x;
                    initialY = layoutParams.y;
                    initialTouchX = event.getRawX();
                    initialTouchY = event.getRawY();
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int deltaX = Math.round(event.getRawX() - initialTouchX);
                    int deltaY = Math.round(event.getRawY() - initialTouchY);
                    if (Math.abs(deltaX) > dp(5) || Math.abs(deltaY) > dp(5)) dragging = true;
                    if (!dragging) return true;
                    layoutParams.x = initialX + deltaX;
                    layoutParams.y = Math.max(dp(24), initialY + deltaY);
                    try {
                        windowManager.updateViewLayout(chatHeadView, layoutParams);
                    } catch (Exception ignored) {
                        return true;
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (dragging) {
                        getSharedPreferences(SyncrovaNativeBridgePlugin.PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .putInt(POSITION_X_KEY, layoutParams.x)
                            .putInt(POSITION_Y_KEY, layoutParams.y)
                            .apply();
                        return true;
                    }
                    openChat();
                    return true;
                default:
                    return false;
            }
        }
    }
}
