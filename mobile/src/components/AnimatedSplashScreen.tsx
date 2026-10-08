import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';

type AnimatedSplashScreenProps = {
  children: React.ReactNode;
  ready: boolean;
  minimumDurationMs?: number;
};

type SyncrovaLogoProps = {
  size: number;
};

function SyncrovaVectorLogo({ size }: SyncrovaLogoProps) {
  return (
    <Svg height={size} viewBox="0 0 128 128" width={size}>
      <Path
        d="M31 24h66c10.5 0 19 8.5 19 19v55c0 10.5-8.5 19-19 19H31c-10.5 0-19-8.5-19-19V43c0-10.5 8.5-19 19-19Z"
        fill="#5D5960"
        stroke="#09090B"
        strokeLinejoin="round"
        strokeWidth={5}
      />
      <Circle cx={64} cy={70} fill="#09090B" r={35} />
      <Circle cx={64} cy={70} fill="#FFD400" r={29} />
      <Circle cx={64} cy={70} fill="#09090B" r={16} />
      <Circle cx={64} cy={70} fill="#EAF4FF" r={10.5} />
      <Circle cx={96} cy={45} fill="#09090B" r={11} />
      <Circle cx={96} cy={45} fill="#EAF4FF" r={5.3} />
      <Rect fill="rgba(255,255,255,0.16)" height={18} rx={9} width={52} x={26} y={33} />
    </Svg>
  );
}

function OrbitRing({ size }: { size: number }) {
  return (
    <Svg height={size} viewBox="0 0 120 120" width={size}>
      <Circle
        cx={60}
        cy={60}
        fill="none"
        r={52}
        stroke="#0084FF"
        strokeDasharray="92 235"
        strokeLinecap="round"
        strokeWidth={4}
      />
      <Circle
        cx={60}
        cy={60}
        fill="none"
        r={45}
        stroke="#FFD400"
        strokeDasharray="58 225"
        strokeDashoffset={92}
        strokeLinecap="round"
        strokeWidth={3}
      />
      <Circle
        cx={60}
        cy={60}
        fill="none"
        r={37}
        stroke="#31A24C"
        strokeDasharray="42 190"
        strokeDashoffset={134}
        strokeLinecap="round"
        strokeWidth={3}
      />
    </Svg>
  );
}

export default function AnimatedSplashScreen({
  children,
  ready,
  minimumDurationMs = 1050
}: AnimatedSplashScreenProps) {
  const { width, height } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const [visible, setVisible] = useState(true);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const loop = useSharedValue(0);
  const pulse = useSharedValue(0);
  const exit = useSharedValue(0);
  const isDark = colorScheme !== 'light';
  const logoSize = Math.min(154, Math.max(102, Math.min(width, height) * 0.28));
  const ringSize = logoSize * 1.62;

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinimumElapsed(true);
    }, minimumDurationMs);

    loop.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1050, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );

    return () => {
      clearTimeout(timer);
      cancelAnimation(loop);
      cancelAnimation(pulse);
      cancelAnimation(exit);
    };
  }, [exit, loop, minimumDurationMs, pulse]);

  useEffect(() => {
    if (!ready || !minimumElapsed || !visible) return;
    exit.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }, finished => {
      if (finished) runOnJS(setVisible)(false);
    });
  }, [exit, minimumElapsed, ready, visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 1], [1, 0]),
    transform: [{ scale: interpolate(exit.value, [0, 1], [1, 1.04]) }]
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 1], [1, 0]),
    transform: [
      { rotate: `${loop.value * 360}deg` },
      { scale: interpolate(pulse.value, [0, 1], [0.98, 1.04]) }
    ]
  }));

  const counterRingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.38, 0.72]) * interpolate(exit.value, [0, 1], [1, 0]),
    transform: [
      { rotate: `${loop.value * -240}deg` },
      { scale: interpolate(pulse.value, [0, 1], [1.08, 0.96]) }
    ]
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 1], [1, 0]),
    transform: [
      { scale: interpolate(pulse.value, [0, 1], [0.975, 1.025]) },
      { scale: interpolate(exit.value, [0, 1], [1, 0.86]) }
    ]
  }));

  return (
    <View style={styles.host}>
      {children}
      {visible ? (
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.overlay,
            { backgroundColor: isDark ? '#050608' : '#F8FAFC' },
            overlayStyle
          ]}
        >
          <View style={[styles.logoStage, { height: ringSize, width: ringSize }]}>
            <Animated.View style={[styles.ring, ringStyle]}>
              <OrbitRing size={ringSize} />
            </Animated.View>
            <Animated.View style={[styles.ring, counterRingStyle]}>
              <OrbitRing size={ringSize * 0.78} />
            </Animated.View>
            <Animated.View
              style={[
                styles.logoShell,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
                  height: logoSize * 1.16,
                  width: logoSize * 1.16
                },
                logoStyle
              ]}
            >
              <SyncrovaVectorLogo size={logoSize} />
            </Animated.View>
          </View>
          <Text style={[styles.brand, { color: isDark ? '#F8FAFC' : '#111827' }]}>
            Syncrova
          </Text>
          <Text style={[styles.caption, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            Messenger
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1
  },
  overlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  logoStage: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute'
  },
  logoShell: {
    alignItems: 'center',
    borderRadius: 34,
    borderWidth: 1,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.26,
    shadowRadius: 28
  },
  brand: {
    fontSize: 28,
    fontWeight: '900',
    marginTop: 20
  },
  caption: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 3,
    textTransform: 'uppercase'
  }
});
