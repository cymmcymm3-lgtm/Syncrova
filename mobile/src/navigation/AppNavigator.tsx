import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatListScreen from '../screens/ChatListScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import LoginScreen from '../screens/LoginScreen';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function BootScreen() {
  const { colors } = useTheme();
  return (
    <View className="flex-1 px-5 pt-16" style={{ backgroundColor: colors.background }}>
      <View className="mb-8 h-16 w-16 rounded-3xl" style={{ backgroundColor: colors.surface }} />
      <View className="mb-2 h-8 w-56 rounded-2xl" style={{ backgroundColor: colors.surface }} />
      <Text className="mb-8 text-sm font-semibold" style={{ color: colors.mutedText }}>Opening Messenger</Text>
      {[0, 1, 2, 3, 4].map(index => (
        <View className="mb-4 h-16 flex-row items-center gap-3 rounded-3xl px-3" key={index} style={{ backgroundColor: colors.surface }}>
          <View className="h-11 w-11 rounded-full" style={{ backgroundColor: colors.elevated }} />
          <View className="min-w-0 flex-1">
            <View className="mb-2 h-4 w-32 rounded-full" style={{ backgroundColor: colors.elevated }} />
            <View className="h-3 w-44 rounded-full" style={{ backgroundColor: colors.elevated }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AppNavigator() {
  const { loading, isAuthenticated } = useAuth();
  const { colors } = useTheme();

  if (loading) return <BootScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background }
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen name="ChatList" component={ChatListScreen} />
            <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
