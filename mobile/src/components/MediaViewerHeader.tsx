import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from './Avatar';
import type { MediaViewerItem } from '../utils/mediaHelpers';
import { formatMediaTimestamp } from '../utils/mediaHelpers';

type MediaViewerHeaderProps = {
  item?: MediaViewerItem;
  visible: boolean;
  onClose: () => void;
};

export default function MediaViewerHeader({ item, visible, onClose }: MediaViewerHeaderProps) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View
      className="absolute left-0 right-0 top-0 z-20 flex-row items-center gap-3 px-4 pb-4"
      style={{ backgroundColor: 'transparent', paddingTop: insets.top + 10 }}
    >
      <Pressable className="h-10 w-10 items-center justify-center rounded-full" onPress={onClose}>
        <X color="#9DB2FF" size={25} />
      </Pressable>
      <Avatar name={item?.senderName} size={34} uri={item?.senderAvatar} />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold text-white" numberOfLines={1}>
          {item?.senderName || 'Syncrova'}
        </Text>
        <Text className="mt-0.5 text-xs text-white/70" numberOfLines={1}>
          {formatMediaTimestamp(item?.timestamp)}
        </Text>
      </View>
    </View>
  );
}
