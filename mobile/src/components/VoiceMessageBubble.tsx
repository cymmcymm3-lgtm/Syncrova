import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type { MessageAttachment } from '../types';
import { formatDuration } from '../utils/mediaHelpers';
import { resolveMediaUrl } from '../utils/media';
import WaveformAnimation from './WaveformAnimation';

type VoiceMessageBubbleProps = {
  id: string;
  attachment: MessageAttachment;
  isMe: boolean;
};

export default function VoiceMessageBubble({ id, attachment, isMe }: VoiceMessageBubbleProps) {
  const player = useAudioPlayer();
  const uri = useMemo(() => resolveMediaUrl(attachment.fileUrl), [attachment.fileUrl]);
  const active = player.playingId === id;
  const playing = active && player.isPlaying;
  const durationMs = attachment.durationMs || player.durationMs || 0;
  const positionMs = active ? player.positionMs : 0;
  const remainingText = active && positionMs > 0 ? formatDuration(positionMs) : formatDuration(durationMs);

  const foreground = isMe ? '#FFFFFF' : '#0A7CFF';
  const dim = isMe ? 'rgba(255,255,255,0.46)' : '#94A3B8';
  const played = isMe ? 'rgba(255,255,255,0.9)' : '#0A7CFF';

  return (
    <View
      className={`mb-1 h-12 w-[212px] flex-row items-center gap-2 rounded-3xl px-2.5 ${isMe ? 'bg-white/10' : 'bg-slate-100'}`}
    >
      <Pressable
        className={`h-9 w-9 items-center justify-center rounded-full ${isMe ? 'bg-white/20' : 'bg-white'}`}
        onPress={() => player.play({ id, uri }).catch(() => {})}
      >
        {playing ? (
          <Pause color={foreground} fill={foreground} size={17} />
        ) : (
          <Play color={foreground} fill={foreground} size={17} />
        )}
      </Pressable>
      <WaveformAnimation
        activeColor={foreground}
        durationMs={durationMs}
        id={id}
        inactiveColor={dim}
        playedColor={played}
        playing={playing}
        positionMs={positionMs}
      />
      <Text className={`w-11 text-right text-[11px] font-semibold ${isMe ? 'text-white/85' : 'text-slate-600'}`} numberOfLines={1}>
        {remainingText}
      </Text>
    </View>
  );
}
