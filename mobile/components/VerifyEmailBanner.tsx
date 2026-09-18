import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';

/**
 * Shown while the signed-in address is unverified.
 *
 * The planner API refuses every request until the link in the verification
 * mail is opened, so without this the tabs would just show an empty planner.
 */
export default function VerifyEmailBanner() {
  const { user, configured, refreshUser, resendVerification } = useAuth();
  const { colors, accent } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  if (!configured || !user || user.emailVerified) return null;

  const check = async () => {
    setBusy(true);
    setStatus('');
    try {
      const refreshed = await refreshUser();
      if (!refreshed?.emailVerified) setStatus('Not verified yet. Open the link in the email, then try again.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not check just now.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setStatus('');
    try {
      await resendVerification();
      setStatus(`Sent to ${user.email}.`);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      setStatus(code === 'auth/too-many-requests'
        ? 'Too many requests. Wait a few minutes before resending.'
        : error instanceof Error ? error.message : 'Could not send the email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[s.wrap, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}
      accessibilityRole="alert"
    >
      <Text style={[s.text, { color: colors.text }]}>
        <Text style={s.strong}>Verify your email. </Text>
        We sent a link to {user.email}; the planner stays read-only until it is opened.
      </Text>
      <View style={s.actions}>
        <Pressable onPress={resend} disabled={busy} accessibilityRole="button">
          <Text style={[s.action, { color: colors.textMuted }]}>Resend</Text>
        </Pressable>
        <Pressable onPress={check} disabled={busy} accessibilityRole="button">
          <Text style={[s.action, { color: accent.primary }]}>I’ve verified</Text>
        </Pressable>
      </View>
      {status ? <Text style={[s.status, { color: colors.textMuted }]}>{status}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  text: { fontSize: 13, lineHeight: 18 },
  strong: { fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 18 },
  action: { fontSize: 14, fontWeight: '600' },
  status: { fontSize: 12.5 },
});
