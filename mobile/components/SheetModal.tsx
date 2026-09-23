import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/useAppTheme';

/**
 * A full-height form modal: a page sheet on iOS, and on Android a full-screen
 * window that keeps its header and footer clear of the system bars.
 *
 * Android ignores `presentationStyle`, and with edge-to-edge (always on from
 * SDK 54) the modal draws under the status and navigation bars and the window
 * no longer resizes for the keyboard. Both are handled here so each form does
 * not have to.
 */
export default function SheetModal({
  visible, animationType, onRequestClose, children,
}: {
  visible: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  onRequestClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} animationType={animationType} presentationStyle="pageSheet" onRequestClose={onRequestClose}>
        {children}
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType={animationType} onRequestClose={onRequestClose}
      statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
