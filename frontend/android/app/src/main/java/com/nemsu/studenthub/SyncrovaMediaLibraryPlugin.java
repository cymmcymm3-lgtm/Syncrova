package com.nemsu.studenthub;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

@CapacitorPlugin(
    name = "SyncrovaMediaLibrary",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = SyncrovaMediaLibraryPlugin.PERMISSION_STORAGE),
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = SyncrovaMediaLibraryPlugin.PERMISSION_IMAGES),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VIDEO }, alias = SyncrovaMediaLibraryPlugin.PERMISSION_VIDEOS),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }, alias = SyncrovaMediaLibraryPlugin.PERMISSION_VISUAL)
    }
)
public class SyncrovaMediaLibraryPlugin extends Plugin {
    static final String PERMISSION_STORAGE = "storage";
    static final String PERMISSION_IMAGES = "images";
    static final String PERMISSION_VIDEOS = "videos";
    static final String PERMISSION_VISUAL = "visual";

    @PluginMethod
    public void checkMediaPermissions(PluginCall call) {
        resolvePermission(call);
    }

    @PluginMethod
    public void requestMediaPermissions(PluginCall call) {
        if (hasMediaPermission()) {
            resolvePermission(call);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(
                new String[] { PERMISSION_IMAGES, PERMISSION_VIDEOS, PERMISSION_VISUAL },
                call,
                "mediaPermissionsCallback"
            );
        } else {
            requestPermissionForAlias(PERMISSION_STORAGE, call, "mediaPermissionsCallback");
        }
    }

    @PermissionCallback
    private void mediaPermissionsCallback(PluginCall call) {
        resolvePermission(call);
    }

    @PluginMethod
    public void listMedia(PluginCall call) {
        if (!hasMediaPermission()) {
            JSObject result = new JSObject();
            result.put("permission", getPermissionText());
            result.put("assets", new JSArray());
            call.resolve(result);
            return;
        }

        String filter = call.getString("filter", "all");
        Integer requestedLimit = call.getInt("limit", 90);
        Integer requestedOffset = call.getInt("offset", 0);
        int limit = Math.min(Math.max(requestedLimit == null ? 90 : requestedLimit, 1), 150);
        int offset = Math.max(requestedOffset == null ? 0 : requestedOffset, 0);

        try {
            JSArray assets = queryMedia(filter, limit, offset);
            JSObject result = new JSObject();
            result.put("permission", getPermissionText());
            result.put("assets", assets);
            call.resolve(result);
        } catch (Exception err) {
            call.reject("Could not load media library", err);
        }
    }

    @PluginMethod
    public void copyMediaToCache(PluginCall call) {
        if (!hasMediaPermission()) {
            call.reject("Media permission was not granted");
            return;
        }

        String uriValue = call.getString("uri", "");
        if (uriValue == null || uriValue.trim().isEmpty()) {
            call.reject("Media source is unavailable");
            return;
        }

        new Thread(() -> copyMediaToCacheInBackground(call, uriValue), "syncrova-media-copy").start();
    }

    private void copyMediaToCacheInBackground(PluginCall call, String uriValue) {
        Uri sourceUri = Uri.parse(uriValue);
        String mimeType = call.getString("mimeType", "");
        String mediaType = call.getString("type", "image");
        String fileName = getSafeCacheFileName(call.getString("name", ""), mimeType, mediaType);
        File cacheDir = new File(getContext().getCacheDir(), "syncrova-media-selection");

        try {
            if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                call.reject("Could not prepare selected media");
                return;
            }

            File outputFile = new File(cacheDir, System.currentTimeMillis() + "-" + fileName);
            long bytesCopied = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(sourceUri)) {
                if (input == null) {
                    call.reject("Could not read selected media");
                    return;
                }

                try (OutputStream output = new FileOutputStream(outputFile)) {
                    byte[] buffer = new byte[256 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        bytesCopied += read;
                    }
                }
            }

            if (bytesCopied <= 0 || outputFile.length() <= 0) {
                if (outputFile.exists()) outputFile.delete();
                call.reject("Selected media is empty");
                return;
            }

            Uri cachedUri = Uri.fromFile(outputFile);
            JSObject result = new JSObject();
            result.put("uri", cachedUri.toString());
            result.put("webPath", cachedUri.toString());
            result.put("name", fileName);
            result.put("mimeType", mimeType);
            result.put("type", "video".equals(mediaType) ? "video" : "image");
            result.put("size", outputFile.length());
            call.resolve(result);
        } catch (Exception err) {
            call.reject("Could not prepare selected media", err);
        }
    }

    private JSArray queryMedia(String filter, int limit, int offset) {
        JSArray assets = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Files.getContentUri("external");
        String[] projection = new String[] {
            MediaStore.Files.FileColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            "duration"
        };

        String mediaTypeColumn = MediaStore.Files.FileColumns.MEDIA_TYPE;
        String selection;
        String[] selectionArgs;
        boolean canReadImages = canReadImages();
        boolean canReadVideos = canReadVideos();
        if ("image".equals(filter) && canReadImages) {
            selection = mediaTypeColumn + "=?";
            selectionArgs = new String[] { String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE) };
        } else if ("video".equals(filter) && canReadVideos) {
            selection = mediaTypeColumn + "=?";
            selectionArgs = new String[] { String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO) };
        } else if (!"image".equals(filter) && !"video".equals(filter) && canReadImages && canReadVideos) {
            selection = mediaTypeColumn + " IN (?,?)";
            selectionArgs = new String[] {
                String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE),
                String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
            };
        } else if (!"video".equals(filter) && canReadImages) {
            selection = mediaTypeColumn + "=?";
            selectionArgs = new String[] { String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE) };
        } else if (!"image".equals(filter) && canReadVideos) {
            selection = mediaTypeColumn + "=?";
            selectionArgs = new String[] { String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO) };
        } else {
            return assets;
        }

        String sortOrder = MediaStore.MediaColumns.DATE_ADDED + " DESC";
        Cursor cursor = resolver.query(collection, projection, selection, selectionArgs, sortOrder);
        if (cursor == null) return assets;

        try {
            int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
            int nameColumn = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeColumn = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int sizeColumn = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
            int dateAddedColumn = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED);
            int dateModifiedColumn = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
            int mediaTypeColumnIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.MEDIA_TYPE);
            int widthColumn = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH);
            int heightColumn = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
            int durationColumn = cursor.getColumnIndex("duration");

            int seen = 0;
            while (cursor.moveToNext() && assets.length() < limit) {
                if (seen++ < offset) continue;

                long id = cursor.getLong(idColumn);
                int mediaType = getInt(cursor, mediaTypeColumnIndex);
                boolean isVideo = mediaType == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                Uri contentUri = ContentUris.withAppendedId(collection, id);
                String mimeType = getString(cursor, mimeColumn);
                long dateModified = getLong(cursor, dateModifiedColumn);

                JSObject asset = new JSObject();
                asset.put("id", String.valueOf(id));
                asset.put("uri", contentUri.toString());
                asset.put("name", getString(cursor, nameColumn));
                asset.put("mimeType", mimeType);
                asset.put("type", isVideo ? "video" : "image");
                asset.put("size", getLong(cursor, sizeColumn));
                asset.put("dateAdded", getLong(cursor, dateAddedColumn));
                asset.put("dateModified", dateModified);
                asset.put("width", getInt(cursor, widthColumn));
                asset.put("height", getInt(cursor, heightColumn));
                asset.put("duration", isVideo ? getLong(cursor, durationColumn) : 0);
                if (isVideo) {
                    asset.put("thumbnailUri", getCachedVideoThumbnailUri(id, dateModified));
                }
                assets.put(asset);
            }
        } finally {
            cursor.close();
        }

        return assets;
    }

    private String getCachedVideoThumbnailUri(long id, long dateModified) {
        try {
            File thumbnailDir = new File(getContext().getCacheDir(), "syncrova-media-thumbnails");
            File thumbnailFile = new File(thumbnailDir, "video-" + id + "-" + Math.max(0, dateModified) + ".jpg");
            if (thumbnailFile.exists() && thumbnailFile.length() > 0) {
                return Uri.fromFile(thumbnailFile).toString();
            }
        } catch (Exception ignored) {
            return "";
        }

        return "";
    }

    private String createVideoThumbnailUri(ContentResolver resolver, Uri contentUri, long id, long dateModified) {
        try {
            File thumbnailDir = new File(getContext().getCacheDir(), "syncrova-media-thumbnails");
            if (!thumbnailDir.exists() && !thumbnailDir.mkdirs()) return "";

            File thumbnailFile = new File(thumbnailDir, "video-" + id + "-" + Math.max(0, dateModified) + ".jpg");
            if (thumbnailFile.exists() && thumbnailFile.length() > 0) {
                return Uri.fromFile(thumbnailFile).toString();
            }

            Bitmap thumbnail = loadVideoThumbnail(resolver, contentUri, id);
            if (thumbnail == null) return "";

            try (FileOutputStream output = new FileOutputStream(thumbnailFile)) {
                thumbnail.compress(Bitmap.CompressFormat.JPEG, 84, output);
            } finally {
                thumbnail.recycle();
            }

            return Uri.fromFile(thumbnailFile).toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    @SuppressWarnings("deprecation")
    private Bitmap loadVideoThumbnail(ContentResolver resolver, Uri contentUri, long id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                return resolver.loadThumbnail(contentUri, new Size(360, 360), null);
            } catch (Exception ignored) {
                // Fall back to the legacy thumbnail API below.
            }
        }

        try {
            return MediaStore.Video.Thumbnails.getThumbnail(
                resolver,
                id,
                MediaStore.Video.Thumbnails.MINI_KIND,
                null
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    private void resolvePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("permission", getPermissionText());
        call.resolve(result);
    }

    private boolean hasMediaPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState(PERMISSION_IMAGES) == PermissionState.GRANTED
                || getPermissionState(PERMISSION_VIDEOS) == PermissionState.GRANTED
                || getPermissionState(PERMISSION_VISUAL) == PermissionState.GRANTED;
        }
        return getPermissionState(PERMISSION_STORAGE) == PermissionState.GRANTED;
    }

    private boolean canReadImages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState(PERMISSION_STORAGE) == PermissionState.GRANTED;
        }
        return getPermissionState(PERMISSION_IMAGES) == PermissionState.GRANTED
            || getPermissionState(PERMISSION_VISUAL) == PermissionState.GRANTED;
    }

    private boolean canReadVideos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState(PERMISSION_STORAGE) == PermissionState.GRANTED;
        }
        return getPermissionState(PERMISSION_VIDEOS) == PermissionState.GRANTED
            || getPermissionState(PERMISSION_VISUAL) == PermissionState.GRANTED;
    }

    private String getPermissionText() {
        if (hasMediaPermission()) return "granted";
        PermissionState state = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? getBestScopedMediaPermissionState()
            : getPermissionState(PERMISSION_STORAGE);
        return state == null ? "prompt" : state.toString();
    }

    private PermissionState getBestScopedMediaPermissionState() {
        PermissionState imageState = getPermissionState(PERMISSION_IMAGES);
        PermissionState videoState = getPermissionState(PERMISSION_VIDEOS);
        PermissionState visualState = getPermissionState(PERMISSION_VISUAL);
        if (imageState == PermissionState.GRANTED || videoState == PermissionState.GRANTED || visualState == PermissionState.GRANTED) {
            return PermissionState.GRANTED;
        }
        if (imageState == PermissionState.PROMPT_WITH_RATIONALE
            || videoState == PermissionState.PROMPT_WITH_RATIONALE
            || visualState == PermissionState.PROMPT_WITH_RATIONALE) {
            return PermissionState.PROMPT_WITH_RATIONALE;
        }
        if (imageState == PermissionState.PROMPT || videoState == PermissionState.PROMPT || visualState == PermissionState.PROMPT) {
            return PermissionState.PROMPT;
        }
        return PermissionState.DENIED;
    }

    private String getString(Cursor cursor, int column) {
        if (column < 0 || cursor.isNull(column)) return "";
        return cursor.getString(column);
    }

    private int getInt(Cursor cursor, int column) {
        if (column < 0 || cursor.isNull(column)) return 0;
        return cursor.getInt(column);
    }

    private long getLong(Cursor cursor, int column) {
        if (column < 0 || cursor.isNull(column)) return 0;
        return cursor.getLong(column);
    }

    private String getSafeCacheFileName(String name, String mimeType, String mediaType) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|]+", "-").trim();
        if (cleaned.isEmpty()) cleaned = "syncrova-" + ("video".equals(mediaType) ? "video" : "image");

        String lower = cleaned.toLowerCase(Locale.US);
        if (lower.matches(".*\\.[a-z0-9]{2,5}$")) return cleaned;

        return cleaned + "." + getExtensionFromMime(mimeType, mediaType);
    }

    private String getExtensionFromMime(String mimeType, String mediaType) {
        if (mimeType != null && !mimeType.isEmpty()) {
            String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            if (extension != null && !extension.isEmpty()) return extension;
            String lower = mimeType.toLowerCase(Locale.US);
            if (lower.contains("quicktime")) return "mov";
            if (lower.contains("webm")) return "webm";
            if (lower.contains("png")) return "png";
            if (lower.contains("webp")) return "webp";
            if (lower.contains("gif")) return "gif";
            if (lower.contains("heic")) return "heic";
        }

        return "video".equals(mediaType) ? "mp4" : "jpg";
    }
}
