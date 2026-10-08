import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowLeft, Database, ExternalLink, Gauge, LogOut } from 'lucide-react-native';
import { API_BASE_URL } from '../config';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../types';
import { openMainSyncrova } from '../utils/openSyncrova';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<Navigation>();
  const { logout } = useAuth();
  const { colors } = useTheme();
  const switchToSyncrova = async () => {
    const opened = await openMainSyncrova();
    if (!opened) Alert.alert('Syncrova', 'Could not open Syncrova on this device.');
  };

  return (
    <View className="flex-1 pt-12" style={{ backgroundColor: colors.background }}>
      <View className="h-14 flex-row items-center px-3">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full" onPress={() => navigation.goBack()} style={{ backgroundColor: colors.surface }}>
          <ArrowLeft color={colors.text} size={22} />
        </Pressable>
        <Text className="ml-2 text-lg font-semibold" style={{ color: colors.text }}>Settings</Text>
      </View>

      <View className="gap-3 px-5 pt-5">
        <View className="rounded-3xl p-4" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <Gauge color="#0A7CFF" size={20} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-semibold" style={{ color: colors.text }}>Native performance mode</Text>
              <Text className="mt-0.5 text-sm" numberOfLines={2} style={{ color: colors.mutedText }}>
                FlashList, Reanimated, and gesture-handler are active in this app.
              </Text>
            </View>
          </View>
        </View>

        <View className="rounded-3xl p-4" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: colors.elevated }}>
              <Database color={colors.text} size={20} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-semibold" style={{ color: colors.text }}>Backend</Text>
              <Text className="mt-0.5 text-sm" numberOfLines={3} style={{ color: colors.mutedText }}>
                {API_BASE_URL}
              </Text>
            </View>
          </View>
        </View>

        <Pressable className="h-14 flex-row items-center justify-center gap-2 rounded-2xl" onPress={switchToSyncrova} style={{ backgroundColor: colors.primary }}>
          <ExternalLink color="#FFFFFF" size={18} />
          <Text className="font-semibold text-white">Switch to Syncrova</Text>
        </Pressable>

        <Pressable className="mt-2 h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-red-50" onPress={logout}>
          <LogOut color="#DC2626" size={18} />
          <Text className="font-semibold text-red-600">Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}
