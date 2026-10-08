package com.nemsu.studenthub;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SyncrovaNativeBridge")
public class SyncrovaNativeBridgePlugin extends Plugin {
    static final String PREFS_NAME = "syncrova_native";
    static final String AUTH_TOKEN_KEY = "auth_token";
    static final String API_BASE_URL_KEY = "api_base_url";
    static final String USER_ID_KEY = "user_id";
    static final String CHAT_HEADS_ENABLED_KEY = "chat_heads_enabled";
    private static final String MAIN_PACKAGE = "com.nemsu.studenthub";
    private static final String MAIN_SCHEME = "syncrova";
    private static final String MESSENGER_PACKAGE = "com.nemsu.studenthub.messenger";
    private static final String MESSENGER_SCHEME = "syncrova-messenger";

    @PluginMethod
    public void syncAuth(PluginCall call) {
        String token = call.getString("token", "");
        String apiBaseUrl = call.getString("apiBaseUrl", "");
        String userId = call.getString("userId", "");

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(AUTH_TOKEN_KEY, token == null ? "" : token)
            .putString(API_BASE_URL_KEY, apiBaseUrl == null ? "" : apiBaseUrl)
            .putString(USER_ID_KEY, userId == null ? "" : userId)
            .apply();

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void clearAuth(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .remove(AUTH_TOKEN_KEY)
            .remove(API_BASE_URL_KEY)
            .remove(USER_ID_KEY)
            .apply();

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Missing URL");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getMessengerStatus(PluginCall call) {
        Integer minVersionCode = call.getInt("minVersionCode", 0);
        call.resolve(createMessengerStatus(minVersionCode == null ? 0 : minVersionCode));
    }

    @PluginMethod
    public void openMessenger(PluginCall call) {
        String path = normalizeMessengerPath(call.getString("path", "/messages"));
        Integer minVersionCodeValue = call.getInt("minVersionCode", 0);
        int minVersionCode = minVersionCodeValue == null ? 0 : minVersionCodeValue;
        JSObject result = new JSObject();
        PackageInfo packageInfo = getMessengerPackageInfo();
        boolean installed = packageInfo != null;
        result.put("installed", installed);

        if (!installed) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }

        long installedVersionCode = getPackageVersionCode(packageInfo);
        result.put("versionCode", installedVersionCode);
        result.put("versionName", packageInfo.versionName == null ? "" : packageInfo.versionName);

        if (minVersionCode > 0 && installedVersionCode < minVersionCode) {
            result.put("opened", false);
            result.put("updateRequired", true);
            result.put("minVersionCode", minVersionCode);
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(MESSENGER_SCHEME + "://open" + path));
            intent.setPackage(MESSENGER_PACKAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception firstError) {
            try {
                Intent launchIntent = getContext().getPackageManager().getLaunchIntentForPackage(MESSENGER_PACKAGE);
                if (launchIntent == null) {
                    result.put("opened", false);
                    call.resolve(result);
                    return;
                }
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launchIntent);
                result.put("opened", true);
                call.resolve(result);
            } catch (Exception secondError) {
                call.reject("Could not open Syncrova Messenger", secondError);
            }
        }
    }

    @PluginMethod
    public void openMainApp(PluginCall call) {
        String path = normalizeAppPath(call.getString("path", "/dashboard"), "/dashboard");
        JSObject result = new JSObject();
        boolean installed = isMainAppInstalled();
        result.put("installed", installed);

        if (!installed) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(MAIN_SCHEME + "://open" + path));
            intent.setPackage(MAIN_PACKAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception firstError) {
            try {
                Intent launchIntent = getContext().getPackageManager().getLaunchIntentForPackage(MAIN_PACKAGE);
                if (launchIntent == null) {
                    result.put("opened", false);
                    call.resolve(result);
                    return;
                }
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launchIntent);
                result.put("opened", true);
                call.resolve(result);
            } catch (Exception secondError) {
                call.reject("Could not open Syncrova", secondError);
            }
        }
    }

    @PluginMethod
    public void getChatHeadsStatus(PluginCall call) {
        call.resolve(createChatHeadsStatus());
    }

    @PluginMethod
    public void setChatHeadsEnabled(PluginCall call) {
        Boolean enabledValue = call.getBoolean("enabled");
        boolean enabled = enabledValue != null && enabledValue;

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(CHAT_HEADS_ENABLED_KEY, enabled).apply();

        if (!enabled) {
            SyncrovaChatHeadService.hide(getContext());
        } else if (!Settings.canDrawOverlays(getContext())) {
            openOverlaySettings();
        }

        call.resolve(createChatHeadsStatus());
    }

    @PluginMethod
    public void openChatHeadSettings(PluginCall call) {
        openOverlaySettings();
        call.resolve(createChatHeadsStatus());
    }

    private JSObject createMessengerStatus(int minVersionCode) {
        PackageInfo packageInfo = getMessengerPackageInfo();
        JSObject result = new JSObject();
        boolean installed = packageInfo != null;
        result.put("installed", installed);
        result.put("minVersionCode", minVersionCode);

        if (installed) {
            long versionCode = getPackageVersionCode(packageInfo);
            result.put("versionCode", versionCode);
            result.put("versionName", packageInfo.versionName == null ? "" : packageInfo.versionName);
            result.put("updateRequired", minVersionCode > 0 && versionCode < minVersionCode);
        } else {
            result.put("versionCode", 0);
            result.put("versionName", "");
            result.put("updateRequired", false);
        }

        return result;
    }

    private PackageInfo getMessengerPackageInfo() {
        try {
            return getContext().getPackageManager().getPackageInfo(MESSENGER_PACKAGE, 0);
        } catch (PackageManager.NameNotFoundException ignored) {
            return null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private long getPackageVersionCode(PackageInfo packageInfo) {
        if (packageInfo == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return packageInfo.getLongVersionCode();
        return packageInfo.versionCode;
    }

    private boolean isMainAppInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(MAIN_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    private JSObject createChatHeadsStatus() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", prefs.getBoolean(CHAT_HEADS_ENABLED_KEY, true));
        result.put("canDrawOverlays", Settings.canDrawOverlays(getContext()));
        return result;
    }

    private void openOverlaySettings() {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private String normalizeMessengerPath(String rawPath) {
        String value = normalizeAppPath(rawPath, "/messages");
        if (!value.startsWith("/messages")) return "/messages";
        return value;
    }

    private String normalizeAppPath(String rawPath, String fallbackPath) {
        String fallback = fallbackPath == null || fallbackPath.trim().isEmpty() ? "/" : fallbackPath.trim();
        String value = rawPath == null || rawPath.trim().isEmpty() ? fallback : rawPath.trim();
        if (!value.startsWith("/")) value = "/" + value;
        return value.replaceAll("[\\r\\n]", "");
    }
}
