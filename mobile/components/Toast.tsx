import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/useAppTheme';
import { useSettings } from '@/contexts/SettingsContext';
import { tabBarSpace } from '@/utils/tabBarSpace';
import { current, dismiss, enqueue, makeToast, Toast, ToastKind } from '@/utils/toastQueue';

interface ToastApi {
  /** Say what just happened. Returns nothing: a toast is told, not awaited. */
  show: (message: string, kind?: ToastKind, duration?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, accent, appearance } = useAppTheme();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<Toast[]>([]);
  const slide = useRef(new Animated.Value(0)).current;
  const showing = current(queue);

  const show = useCallback((message: string, kind: ToastKind = 'info', duration?: number) => {
    setQueue(previous => enqueue(previous, makeToast(message, kind, duration)));
  }, []);

  const hide = useCallback((id: string) => {
    setQueue(previous => dismiss(previous, id));
  }, []);

  // Announced to VoiceOver as well as shown: a message that only exists as a
  // bar at the bottom of the screen is invisible to anyone not looking at it.
  useEffect(() => {
    if (showing) AccessibilityInfo.announceForAccessibility(showing.message);
  }, [showing]);

  useEffect(() => {
    if (!showing) return;
    if (settings.reducedMotion) {
      slide.setValue(1);
    } else {
      Animated.spring(slide, {
        toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180,
      }).start();
    }
    if (!showing.duration) return;
    const timer = setTimeout(() => hide(showing.id), showing.duration);
    return () => clearTimeout(timer);
  }, [showing, settings.reducedMotion, slide, hide]);

  // Reset for the next message, so the second toast animates in like the first.
  useEffect(() => {
    if (!showing) slide.setValue(0);
  }, [showing, slide]);

  const styles = makeStyles(colors, accent, appearance);
  const tone = showing
    ? {
      success: { surface: colors.successSurface, mark: colors.success },
      error: { surface: colors.errorSurface, mark: colors.error },
      info: { surface: colors.surfaceVariant, mark: accent.primary },
    }[showing.kind]
    : null;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {showing && tone && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { bottom: 12 + tabBarSpace(insets.bottom) },
            {
              opacity: slide,
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            },
          ]}
        >
          <Pressable
            style={[styles.toast, { backgroundColor: tone.surface, borderColor: tone.mark }]}
            onPress={() => hide(showing.id)}
            accessibilityRole="button"
            accessibilityLabel={`${showing.message}. Tap to dismiss.`}
          >
            <Ionicons name={ICONS[showing.kind]} size={17} color={tone.mark} />
            <Text style={styles.text} numberOfLines={3}>{showing.message}</Text>
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Say something to the student in passing.
 *
 * Safe to call from anywhere, including outside the provider, where it does
 * nothing: a missing toast must never be the reason an action fails.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => {} };
}

function makeStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  accent: ReturnType<typeof useAppTheme>['accent'],
  appearance: ReturnType<typeof useAppTheme>['appearance'],
) {
  void accent;
  void appearance;
  return StyleSheet.create({
    wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      maxWidth: 560,
      width: '100%',
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    text: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  });
}

export const __testing = { View };
