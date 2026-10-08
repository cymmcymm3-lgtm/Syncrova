import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Play } from 'lucide-react-native';
import type { MessageAttachment } from '../types';
import { getThumbnailUrl } from '../utils/mediaHelpers';

type VideoMessageBubbleProps = {
  attachment: MessageAttachment;
  onPress: () => void;
  width?: number;
  height?: number;
};

export default function VideoMessageBubble({
  attachment,
  onPress,
  width = 220,
  height = 220
}: VideoMessageBubbleProps) {
  const thumbnailUrl = getThumbnailUrl(attachment);

  return (
    <Pressable
      className="items-center justify-center overflow-hidden bg-slate-900"
      onPress={onPress}
      style={{ borderRadius: 14, height, width }}
    >
      {thumbnailUrl ? (
        <ExpoImage
          cachePolicy="memory-disk"
          contentFit="cover"
          source={{ uri: thumbnailUrl }}
          style={{ height, width }}
          transition={120}
        />
      ) : null}
      <View className="absolute h-12 w-12 items-center justify-center rounded-full bg-black/45">
        <Play color="#FFFFFF" fill="#FFFFFF" size={22} />
      </View>
      <Text className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
        Video
      </Text>
    </Pressable>
  );
}
