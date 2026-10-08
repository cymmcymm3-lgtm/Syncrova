import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { Download, MessageCircle, MoreHorizontal, Share2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MediaViewerItem } from '../utils/mediaHelpers';

type MediaViewerFooterProps = {
  item?: MediaViewerItem;
  visible: boolean;
  total: number;
  index: number;
  onReply?: () => void;
};

export default function MediaViewerFooter({ item, visible, total, index, onReply }: MediaViewerFooterProps) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  if (!visible) return null;

  const getLocalUri = async () => {
    if (!item?.url) return '';
    if (item.url.startsWith('file://')) return item.url;
    const extension = item.type === 'video' ? 'mp4' : 'jpg';
    const target = `${FileSystem.cacheDirectory || ''}syncrova-media-${Date.now()}.${extension}`;
    const downloaded = await FileSystem.downloadAsync(item.url, target);
    return downloaded.uri;
  };

  const share = async () => {
    if (!item?.url) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Share unavailable', 'Native sharing is not available on this device.');
      return;
    }
    const localUri = await getLocalUri().catch(() => '');
    if (localUri) await Sharing.shareAsync(localUri).catch(() => {});
  };

  const save = async () => {
    if (!item?.url || saving) return;
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow media library access to save this media.');
      return;
    }

    setSaving(true);
    try {
      const localUri = await getLocalUri();
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved', 'Media saved to your gallery.');
    } catch {
      Alert.alert('Save failed', 'Could not save this media.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 z-20 items-center px-5 pt-5"
      style={{ backgroundColor: 'transparent', paddingBottom: insets.bottom + 14 }}
    >
      {total > 1 ? (
        <View className="mb-4 flex-row items-center justify-center gap-1.5">
          {Array.from({ length: total }).map((_, dotIndex) => (
            <View
              className="rounded-full"
              key={dotIndex}
              style={{
                backgroundColor: dotIndex === index ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                height: 6,
                width: dotIndex === index ? 18 : 6
              }}
            />
          ))}
        </View>
      ) : null}
      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="h-12 w-12 items-center justify-center rounded-full bg-black/18" onPress={onReply}>
          <MessageCircle color="#DDE5FF" size={21} />
        </Pressable>
        <Pressable className="h-12 w-12 items-center justify-center rounded-full bg-black/18" onPress={share}>
          <Share2 color="#DDE5FF" size={21} />
        </Pressable>
        <Pressable className="h-12 w-12 items-center justify-center rounded-full bg-black/18" onPress={save}>
          {saving ? <ActivityIndicator color="#DDE5FF" size="small" /> : <Download color="#DDE5FF" size={21} />}
        </Pressable>
        <Pressable className="h-12 w-12 items-center justify-center rounded-full bg-black/18" onPress={() => Alert.alert('More', 'More media options will be available here.')}>
          <MoreHorizontal color="#DDE5FF" size={22} />
        </Pressable>
      </View>
    </View>
  );
}
