import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { createStyles } from '@/theme/createStyles';
import { useAppTheme } from '@/theme/useAppTheme';

/**
 * The Add/Save action in a form sheet's header. It ignores taps while a save
 * runs, and only grays out with a spinner once the save is slow enough to
 * notice (see useSubmit), so a quick save never flickers.
 */
export default function SheetSaveButton({
  label, onPress, busy, showBusy, disabled,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  showBusy: boolean;
  disabled?: boolean;
}) {
  const { colors, accent, appearance } = useAppTheme();
  const st = createStyles(appearance)({ label: { fontSize: 16, fontWeight: '600' } });
  const dimmed = disabled || showBusy;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      hitSlop={8}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {showBusy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text style={[st.label, { color: dimmed ? colors.textMuted : accent.primary }]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** A save failure, shown at the top of the form so it is seen before a retry. */
export function SheetFormError({ message }: { message: string }) {
  const { colors, appearance } = useAppTheme();
  const st = createStyles(appearance)({ text: { fontSize: 14 } });
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 20, marginTop: 12, padding: 12, borderRadius: 10,
        backgroundColor: colors.error + '1A', borderWidth: 1, borderColor: colors.error + '55',
      }}
    >
      <Text style={[st.text, { color: colors.error }]}>{message}</Text>
    </View>
  );
}
