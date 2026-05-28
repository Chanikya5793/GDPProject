const ACCENT_COLORS = {
  green: { primary: '#006A4E', light: '#0AA56F', surface: '#E8F5E9' },
  blue: { primary: '#3B82F6', light: '#60A5FA', surface: '#DBEAFE' },
  purple: { primary: '#7C3AED', light: '#A78BFA', surface: '#F3E8FF' },
  amber: { primary: '#D97706', light: '#FBBF24', surface: '#FEF3C7' },
} as const;

export const lightTheme = {
  background: '#FFFFFF',
  surface: '#F9FAFB',
  surfaceVariant: '#F3F4F6',
  card: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  error: '#DC2626',
  errorSurface: '#FEE2E2',
  warning: '#D97706',
  warningSurface: '#FEF3C7',
  success: '#16A34A',
  successSurface: '#DCFCE7',
  priorityHigh: '#FFA6A6',
  priorityHighText: '#9C4848',
  priorityMedium: '#FFEFB5',
  priorityMediumText: '#92400E',
  priorityLow: '#E2FFAF',
  priorityLowText: '#2D5016',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  statusBar: 'dark' as 'dark' | 'light',
};

export const darkTheme: typeof lightTheme = {
  background: '#0F172A',
  surface: '#1E293B',
  surfaceVariant: '#334155',
  card: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  border: '#334155',
  borderLight: '#1E293B',
  error: '#EF4444',
  errorSurface: '#450A0A',
  warning: '#F59E0B',
  warningSurface: '#451A03',
  success: '#22C55E',
  successSurface: '#052E16',
  priorityHigh: '#7F1D1D',
  priorityHighText: '#FCA5A5',
  priorityMedium: '#78350F',
  priorityMediumText: '#FDE68A',
  priorityLow: '#14532D',
  priorityLowText: '#BBF7D0',
  tabBar: '#1E293B',
  tabBarBorder: '#334155',
  statusBar: 'light',
};

export type ThemeColors = typeof lightTheme;

export function getAccentColors(accent: keyof typeof ACCENT_COLORS) {
  return ACCENT_COLORS[accent] || ACCENT_COLORS.green;
}

export { ACCENT_COLORS };
