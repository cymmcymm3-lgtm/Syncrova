import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BellOff, Pin, Star, Trash2 } from 'lucide-react-native';
import Avatar, { AvatarStoryRing } from './Avatar';
import type { Conversation } from '../types';
import { formatConversationTime } from '../utils/date';
import { getEntityId } from '../utils/ids';
import { useTheme } from '../theme/ThemeContext';

type ChatListItemProps = {
  item: Conversation;
  onPress: () => void;
  onDelete: () => void;
  displayName?: string;
  pinned?: boolean;
  muted?: boolean;
  favorite?: boolean;
  online?: boolean;
  presenceLabel?: string;
  statusLabel?: string;
  typingLabel?: string;
  storyRing?: AvatarStoryRing;
};

const getPresencePillLabel = (label?: string) => {
  if (!label || label === 'Offline') return '';
  if (label === 'Active now' || label === 'Active just now') return 'Now';
  return label
    .replace(/^Active\s+/i, '')
    .replace(/\s+at\s+.+$/i, '')
    .replace(/^yesterday$/i, '1d ago');
};

const getPresencePillText = (label: string, online: boolean) => {
  if (!online) return label;
  return label === 'Now' ? 'Active now' : label;
};

function ChatListItem({
  item,
  onPress,
  onDelete,
  displayName,
  pinned = false,
  muted = false,
  favorite = false,
  online = false,
  presenceLabel,
  statusLabel,
  typingLabel,
  storyRing = 'none'
}: ChatListItemProps) {
  const user = item.user;
  const { colors } = useTheme();
  const userId = getEntityId(user);
  const translateX = useSharedValue(0);
  const name = displayName || user.name || user.email || 'Syncrova user';
  const activityLabel = presenceLabel || (online ? 'Active now' : statusLabel);
  const presencePillLabel = getPresencePillLabel(activityLabel);
  const presencePillText = getPresencePillText(presencePillLabel, online);
  const subtitle = typingLabel || item.lastMessage || activityLabel || 'Open chat';
  const showActivityLabel = Boolean(!typingLabel && !presencePillLabel && activityLabel && activityLabel !== subtitle && activityLabel !== 'Offline');
  const subtitleClassName = typingLabel
    ? 'font-semibold text-blue-600'
    : item.unreadCount
      ? 'font-semibold text-slate-950'
      : 'text-slate-500';
  const subtitleColor = typingLabel
    ? colors.primary
    : item.unreadCount
      ? colors.text
      : colors.mutedText;

  const confirmDelete = () => {
    Alert.alert('Delete conversation?', user.name || 'This chat', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete }
    ]);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate(event => {
      translateX.value = Math.max(-96, Math.min(0, event.translationX));
    })
    .onEnd(() => {
      if (translateX.value < -72) runOnJS(confirmDelete)();
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }]
  }));

  return (
    <View className="h-[76px] justify-center overflow-hidden" style={{ backgroundColor: colors.background }}>
      <View className="absolute right-0 h-full w-24 items-center justify-center bg-red-500">
        <Trash2 color="white" size={22} />
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={animatedStyle}>
          <Pressable
            className="h-[76px] flex-row items-center gap-3 px-4"
            onLongPress={confirmDelete}
            onPress={onPress}
            style={{ backgroundColor: colors.background }}
          >
            <View className="relative">
              <Avatar online={online} storyRing={storyRing} user={user} size={52} sharedTag={`avatar-${userId}`} />
              {presencePillLabel ? (
                <View
                  className="absolute -bottom-2 self-center flex-row items-center justify-center rounded-full border px-1.5 py-0.5"
                  style={{
                    alignSelf: 'center',
                    backgroundColor: online ? '#ECFDF5' : colors.background,
                    borderColor: online ? '#A7F3D0' : colors.border,
                    left: -6,
                    right: -6
                  }}
                >
                  <Text
                    className="text-center text-[10px] font-black"
                    numberOfLines={1}
                    style={{ color: online ? colors.online : colors.mutedText }}
                  >
                    {presencePillText}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-[15px] font-semibold" numberOfLines={1} style={{ color: colors.text }}>
                  {name}
                </Text>
                {pinned ? <Pin color="#64748B" size={13} /> : null}
                {favorite ? <Star color="#F59E0B" fill="#F59E0B" size={13} /> : null}
                {muted ? <BellOff color="#94A3B8" size={13} /> : null}
                <Text className="text-xs" numberOfLines={1} style={{ color: colors.mutedText }}>
                  {formatConversationTime(item.lastTime)}
                </Text>
              </View>
              <View className="mt-1 flex-row items-center gap-2">
                <Text
                  className={`flex-1 text-[13px] ${subtitleClassName}`}
                  numberOfLines={1}
                  style={{ color: subtitleColor }}
                >
                  {subtitle}
                </Text>
                {showActivityLabel ? (
                  <Text
                    className="max-w-[104px] text-[11px] font-semibold"
                    numberOfLines={1}
                    style={{ color: online ? colors.online : colors.mutedText }}
                  >
                    {activityLabel}
                  </Text>
                ) : null}
                {item.unreadCount ? (
                  <View className="min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5">
                    <Text className="text-[11px] font-semibold text-white" numberOfLines={1}>
                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default React.memo(ChatListItem, (prev, next) => {
  const prevId = getEntityId(prev.item.user);
  const nextId = getEntityId(next.item.user);

  return prevId === nextId
    && prev.item.lastMessage === next.item.lastMessage
    && prev.item.lastTime === next.item.lastTime
    && prev.item.unreadCount === next.item.unreadCount
    && prev.displayName === next.displayName
    && prev.pinned === next.pinned
    && prev.muted === next.muted
    && prev.favorite === next.favorite
    && prev.online === next.online
    && prev.presenceLabel === next.presenceLabel
    && prev.statusLabel === next.statusLabel
    && prev.typingLabel === next.typingLabel
    && prev.storyRing === next.storyRing;
});
