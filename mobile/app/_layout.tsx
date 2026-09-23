import { useEffect } from 'react';
import { AppState } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ToastProvider } from '@/components/Toast';
import DeviceSync from '@/components/DeviceSync';
import { warmUpApi } from '@/api/client';
import { useAppTheme } from '@/theme/useAppTheme';

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
  // The app's own theme setting, not the system's: a student who picked dark
  // on a light-mode phone would otherwise get a light Settings header and
  // dark status bar icons on a dark screen (on Android, where the bars are
  // transparent over the app, the icons disappear entirely).
  const { isDark, colors } = useAppTheme();
  const base = isDark ? DarkTheme : DefaultTheme;
  // The window behind the React root shows through on Android during screen
  // and keyboard transitions; left white, it flashes in dark mode.
  useEffect(() => { SystemUI.setBackgroundColorAsync(colors.background).catch(() => {}); }, [colors.background]);

  return (
    <ThemeProvider value={{
      ...base,
      colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.text, border: colors.border },
    }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
