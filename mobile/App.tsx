import 'react-native-gesture-handler';
import './global.css';

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AnimatedSplashScreen from './src/components/AnimatedSplashScreen';
import { useOnlineStatus } from './src/hooks/useOnlineStatus';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider, useAuth } from './src/store/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { getEntityId } from './src/utils/ids';
import { preloadSoundEffects } from './src/utils/soundEffects';

SplashScreen.preventAutoHideAsync().catch(() => {});

function PresenceBootstrap() {
  const { user } = useAuth();
  useOnlineStatus(getEntityId(user));
  return null;
}

function ThemedStatusBar() {
  const { resolvedMode } = useTheme();
  return <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    SplashScreen.hideAsync().catch(() => {});
    const timer = setTimeout(() => {
      if (mounted) setAppReady(true);
    }, 700);
    preloadSoundEffects();

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <AnimatedSplashScreen ready={appReady}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <PresenceBootstrap />
              <ThemedStatusBar />
              <AppNavigator />
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </AnimatedSplashScreen>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF'
  }
});
