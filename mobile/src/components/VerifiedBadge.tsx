import React from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';

type VerifiedBadgeProps = {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizes = {
  sm: 16,
  md: 20,
  lg: 24
};

export default function VerifiedBadge({ label = 'Verified Student', size = 'sm' }: VerifiedBadgeProps) {
  const { colors } = useTheme();
  const badgeSize = sizes[size];
  const iconSize = Math.max(10, Math.round(badgeSize * 0.68));

  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => Alert.alert('Verified', label)}
      style={[styles.badge, { backgroundColor: colors.primary, borderRadius: badgeSize / 2, height: badgeSize, width: badgeSize }]}
    >
      <Check color={colors.onPrimary} size={iconSize} strokeWidth={3.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center'
  }
});
