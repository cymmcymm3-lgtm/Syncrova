import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import { seededWaveformBars } from '../utils/mediaHelpers';

type WaveformAnimationProps = {
  id: string;
  durationMs?: number;
  positionMs?: number;
  playing?: boolean;
  activeColor: string;
  inactiveColor: string;
  playedColor?: string;
};

function WaveBar({
  height,
  index,
  color,
  playing
}: {
  height: number;
  index: number;
  color: string;
  playing: boolean;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!playing) {
      scale.value = withTiming(1, { duration: 120 });
      return;
    }

    scale.value = withDelay(
      index * 45,
      withRepeat(
        withSequence(withTiming(1.25, { duration: 260 }), withTiming(0.75, { duration: 260 })),
        -1,
        true
      )
    );
  }, [index, playing, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }]
  }));

  return (
    <Animated.View
      className="rounded-full"
      style={[style, { backgroundColor: color, height, width: 3 }]}
    />
  );
}

export default function WaveformAnimation({
  id,
  durationMs = 0,
  positionMs = 0,
  playing = false,
  activeColor,
  inactiveColor,
  playedColor
}: WaveformAnimationProps) {
  const bars = useMemo(() => seededWaveformBars(id, durationMs), [durationMs, id]);
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const playedIndex = Math.floor(progress * bars.length);

  return (
    <View className="h-8 flex-1 flex-row items-center justify-center gap-[3px] overflow-hidden">
      {bars.map((bar, index) => (
        <WaveBar
          color={index <= playedIndex ? playedColor || activeColor : inactiveColor}
          height={8 + Math.round(bar * 22)}
          index={index}
          key={`${id}-${index}`}
          playing={playing && index <= playedIndex + 1}
        />
      ))}
    </View>
  );
}
