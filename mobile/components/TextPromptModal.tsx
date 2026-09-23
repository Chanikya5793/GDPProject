import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';

/**
 * The one-field dialog `Alert.prompt` gives iOS and nothing gives Android.
 *
 * iOS keeps the system prompt; screens render this for the other platforms,
 * where `Alert.prompt` is undefined and a call to it silently does nothing.
 */
export default function TextPromptModal({
  visible, title, initialValue = '', confirmLabel = 'Save', onCancel, onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const { colors, accent, appearance } = useAppTheme();
  const [value, setValue] = useState(initialValue);
  useEffect(() => { if (visible) setValue(initialValue); }, [visible, initialValue]);
  const s = createStyles(appearance)({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 20, gap: 14, elevation: 8 },
    title: { fontSize: 17, fontWeight: '700', color: colors.text },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12,
      paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: colors.surface,
    },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
    cancel: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
    confirm: { color: accent.primary, fontWeight: '700', fontSize: 14 },
  });
  const submit = () => onSubmit(value);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.backdrop} onPress={onCancel} accessibilityLabel="Dismiss">
          <Pressable style={s.card} onPress={() => {}} accessibilityViewIsModal>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            <TextInput
              style={s.input} value={value} onChangeText={setValue} autoFocus selectTextOnFocus
              returnKeyType="done" onSubmitEditing={submit} placeholderTextColor={colors.textMuted}
              accessibilityLabel={title}
            />
            <View style={s.actions}>
              <TouchableOpacity style={s.button} onPress={onCancel} accessibilityRole="button">
                <Text style={s.cancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.button} onPress={submit} accessibilityRole="button">
                <Text style={s.confirm}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
