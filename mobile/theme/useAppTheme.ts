import { useColorScheme } from 'react-native';
import { useSettings } from '@/contexts/SettingsContext';
import { lightTheme, darkTheme, getAccentColors, ThemeColors } from './colors';

export interface AppTheme {
  colors: ThemeColors;
  accent: ReturnType<typeof getAccentColors>;
  isDark: boolean;
}

export function useAppTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const { settings } = useSettings();

  let isDark: boolean;
  if (settings.theme === 'system') {
    isDark = systemScheme === 'dark';
  } else {
    isDark = settings.theme === 'dark';
  }

  return {
    colors: isDark ? darkTheme : lightTheme,
    accent: getAccentColors(settings.accentColor),
    isDark,
  };
}
