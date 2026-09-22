import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ToastProvider } from '@/components/Toast';
import DeviceSync from '@/components/DeviceSync';
import { warmUpApi } from '@/api/client';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // The API scales to zero, so its container start is paid by whoever asks
  // first. Starting it here spends that on the splash screen instead, and
  // again on resume, because an app left in the background overnight comes
  // back to an instance that has long since gone away.
  useEffect(() => {
    warmUpApi();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') warmUpApi();
    });
    return () => subscription.remove();
  }, []);

  return (
    <SettingsProvider>
      <AuthProvider>
        <ToastProvider>
          <DeviceSync />
          <RootLayoutNav />
        </ToastProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            presentation: 'modal',
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
