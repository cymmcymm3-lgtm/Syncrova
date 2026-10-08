import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowLeft, LogOut } from 'lucide-react-native';
import Avatar from '../components/Avatar';
import { useAuth } from '../store/AuthContext';
import { usePresenceStore } from '../store/presenceStore';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../types';
import { formatActiveStatus } from '../utils/date';
import { getEntityId } from '../utils/ids';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Profile'>;

export default function ProfileScreen() {
  const navigation = useNavigation<Navigation>();
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const currentUserId = getEntityId(user);
  const ownPresence = usePresenceStore(state => state.statuses[currentUserId]);
  const online = ownPresence?.online ?? true;
  const statusText = formatActiveStatus({
    online,
    lastSeen: ownPresence?.lastSeen || user?.lastSeen || null
  });

  return (
    <View className="flex-1 pt-12" style={{ backgroundColor: colors.background }}>
      <View className="h-14 flex-row items-center px-3">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full" onPress={() => navigation.goBack()} style={{ backgroundColor: colors.surface }}>
          <ArrowLeft color={colors.text} size={22} />
        </Pressable>
        <Text className="ml-2 text-lg font-semibold" style={{ color: colors.text }}>Profile</Text>
      </View>

      <View className="items-center px-6 pt-8">
        <Avatar online={online} user={user} size={104} sharedTag="profile-avatar" />
        <Text className="mt-5 text-2xl font-bold" numberOfLines={1} style={{ color: colors.text }}>
          {user?.name || 'Syncrova user'}
        </Text>
        <Text className="mt-1 text-sm" numberOfLines={1} style={{ color: colors.mutedText }}>
          {user?.email}
        </Text>
        <Text className="mt-2 text-sm font-bold" numberOfLines={1} style={{ color: online ? colors.online : colors.mutedText }}>
          {statusText}
        </Text>
      </View>

      <View className="mt-10 px-5">
        <View className="rounded-3xl p-4" style={{ backgroundColor: colors.surface }}>
          <Text className="text-xs font-semibold uppercase" style={{ color: colors.mutedText }}>Course</Text>
          <Text className="mt-1 text-base" numberOfLines={2} style={{ color: colors.text }}>
            {user?.course || 'Not set'}
          </Text>
          <View className="my-4 h-px" style={{ backgroundColor: colors.border }} />
          <Text className="text-xs font-semibold uppercase" style={{ color: colors.mutedText }}>Campus</Text>
          <Text className="mt-1 text-base" numberOfLines={2} style={{ color: colors.text }}>
            {user?.campus || 'Not set'}
          </Text>
        </View>

        <Pressable className="mt-5 h-14 flex-row items-center justify-center gap-2 rounded-2xl" onPress={logout} style={{ backgroundColor: colors.elevated }}>
          <LogOut color={colors.danger} size={18} />
          <Text className="font-semibold" style={{ color: colors.danger }}>Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}
