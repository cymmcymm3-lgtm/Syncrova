import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Pause, Play, X } from 'lucide-react-native';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useTheme } from '../theme/ThemeContext';
import { formatDuration } from '../utils/mediaHelpers';

export default function AudioPlayerBanner() {
  const player = useAudioPlayer();
  const { colors } = useTheme();

  if (!player.playingId) return null;

  return (
    <View className="mx-3 mb-2 flex-row items-center gap-3 rounded-2xl px-3 py-2" style={{ backgroundColor: colors.elevated }}>
      <Pressable
        className="h-9 w-9 items-center justify-center rounded-full"
        onPress={() => player.play({ id: player.playingId, uri: player.uri }).catch(() => {})}
        style={{ backgroundColor: colors.primary }}
      >
        {player.isPlaying ? (
          <Pause color="#FFFFFF" fill="#FFFFFF" size={16} />
        ) : (
          <Play color="#FFFFFF" fill="#FFFFFF" size={16} />
        )}
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold" numberOfLines={1} style={{ color: colors.text }}>
          Voice message
        </Text>
        <Text className="text-xs" numberOfLines={1} style={{ color: colors.mutedText }}>
          {formatDuration(player.positionMs)} / {formatDuration(player.durationMs)}
        </Text>
      </View>
      <Pressable className="h-8 w-8 items-center justify-center rounded-full" onPress={() => player.stop().catch(() => {})}>
        <X color={colors.mutedText} size={18} />
      </Pressable>
    </View>
  );
}
