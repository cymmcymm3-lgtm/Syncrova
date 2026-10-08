import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { User } from '../types';
import { resolveMediaUrl } from '../utils/media';
import VerifiedBadge from './VerifiedBadge';
import { useTheme } from '../theme/ThemeContext';

export type AvatarStoryRing = 'unviewed' | 'viewed' | 'none';

type AvatarProps = {
  user?: User | null;
  uri?: string;
  name?: string;
  size?: number;
  sharedTag?: string;
  online?: boolean;
  verified?: boolean;
  storyRing?: AvatarStoryRing;
};

export default function Avatar({ user, uri, name, size = 48, online = false, verified = false, storyRing = 'none' }: AvatarProps) {
  const { colors } = useTheme();
  const displayName = name || user?.name || user?.email || 'User';
  const avatarUri = resolveMediaUrl(uri || user?.avatar || '');
  const isDeveloper = Boolean(user?.isDeveloper);
  const showVerified = verified || isDeveloper;
  const ringVisible = storyRing !== 'none';
  const onlineRingVisible = online;
  const onlineRingPadding = onlineRingVisible ? 3 : 0;
  const storyRingPadding = ringVisible ? 4 : 0;
  const avatarOffset = onlineRingPadding + storyRingPadding;
  const storyRingSize = size + storyRingPadding * 2;
  const outerSize = size + avatarOffset * 2;
  const strokeWidth = storyRing === 'viewed' ? 2 : 3;
  const hasOuterRing = onlineRingVisible || ringVisible;
  const initials = displayName
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const developerPulse = useSharedValue(0);

  useEffect(() => {
    if (!isDeveloper) return;
    developerPulse.value = withRepeat(
      withTiming(1, { duration: 1550, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [developerPulse, isDeveloper]);

  const developerRingStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + developerPulse.value * 0.45,
    transform: [{ scale: 1 + developerPulse.value * 0.08 }]
  }));

  const avatar = avatarUri ? (
    <ExpoImage
      cachePolicy="memory-disk"
      contentFit="cover"
      source={{ uri: avatarUri }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#E2E8F0' }}
      transition={120}
    />
  ) : (
    <View
      className="items-center justify-center bg-slate-200"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Text className="font-semibold text-slate-600" style={{ fontSize: Math.max(12, size * 0.32) }}>
        {initials || 'S'}
      </Text>
    </View>
  );

  return (
    <View style={{ height: outerSize, width: outerSize }}>
      {isDeveloper ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              borderColor: colors.primary,
              borderRadius: outerSize / 2,
              borderWidth: 2,
              bottom: -2,
              left: -2,
              position: 'absolute',
              right: -2,
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.18,
              shadowRadius: 3,
              top: -2
            },
            developerRingStyle
          ]}
        />
      ) : null}
      {onlineRingVisible ? (
        <View
          pointerEvents="none"
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            borderColor: '#22C55E',
            borderRadius: outerSize / 2,
            borderWidth: 3,
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            shadowColor: '#22C55E',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.22,
            shadowRadius: 5,
            top: 0
          }}
        />
      ) : null}
      {ringVisible ? (
        <Svg height={storyRingSize} style={{ position: 'absolute', left: onlineRingPadding, top: onlineRingPadding }} width={storyRingSize}>
          <Defs>
            <LinearGradient id="storyRingGradient" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#FF5E62" />
              <Stop offset="1" stopColor="#FF6D3A" />
            </LinearGradient>
          </Defs>
          <Circle
            cx={storyRingSize / 2}
            cy={storyRingSize / 2}
            fill="transparent"
            r={(storyRingSize - strokeWidth) / 2}
            stroke={storyRing === 'viewed' ? '#B0B3B8' : 'url(#storyRingGradient)'}
            strokeWidth={strokeWidth}
          />
        </Svg>
      ) : null}
      <View style={{ left: avatarOffset, position: 'absolute', top: avatarOffset }}>
        {avatar}
      </View>
      {!online && showVerified ? (
        <View
          style={{
            bottom: hasOuterRing ? 0 : -1,
            position: 'absolute',
            right: hasOuterRing ? 0 : -1
          }}
        >
          <VerifiedBadge label={isDeveloper ? 'Verified Student Developer' : 'Verified Student'} size={size >= 72 ? 'md' : 'sm'} />
        </View>
      ) : null}
      {isDeveloper && online ? (
        <View
          className="absolute items-center justify-center rounded-full"
          style={{
            backgroundColor: colors.elevated,
            borderColor: colors.border,
            borderWidth: 1.5,
            bottom: hasOuterRing ? -2 : -3,
            height: Math.max(17, Math.round(size * 0.32)),
            left: hasOuterRing ? -2 : -3,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.16,
            shadowRadius: 3,
            width: Math.max(17, Math.round(size * 0.32))
          }}
        >
          <Text style={{ color: colors.primary, fontSize: Math.max(8, size * 0.13), fontWeight: '900' }}>{'</>'}</Text>
        </View>
      ) : null}
    </View>
  );
}
