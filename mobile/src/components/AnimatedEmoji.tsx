import React, { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

type AnimatedEmojiProps = {
  emoji: string;
  size?: number;
};

export default function AnimatedEmoji({ emoji, size = 18 }: AnimatedEmojiProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withDelay(80, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) })),
      -1,
      true
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.9 + progress.value * 0.1,
    transform: [
      { translateY: -progress.value * 1.5 },
      { scale: 1 + progress.value * 0.08 }
    ]
  }));

  return (
    <Animated.View style={style}>
      <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.2) }}>{emoji}</Text>
    </Animated.View>
  );
}
