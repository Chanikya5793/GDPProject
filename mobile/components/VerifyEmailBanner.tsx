import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';

// Firebase refuses a second verification mail requested within about a
// minute of the last one, and the app used to hand that refusal to the
// student on their very first Resend. Hold the button for this long instead.
const RESEND_COOLDOWN_MS = 60_000;
// How often to ask Firebase whether the link has been opened. The link is
// tapped in a mail app, not here, so without this the student had to come
// back and press a button before anything worked.
const POLL_MS = 8_000;
const POLL_FOR_MS = 20 * 60_000;

/**
 * Shown while the signed-in address is unverified.
 *
 * The planner API refuses every request until the link in the verification
 * mail is opened, so without this the tabs would just show an empty planner.
 */
export default function VerifyEmailBanner() {
  const { user, configured, refreshUser, resendVerification, verificationSentAt } = useAuth();
  const { colors, accent } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [waitUntil, setWaitUntil] = useState(0);
  const mountedAt = useRef<number | null>(null);
  if (mountedAt.current === null) mountedAt.current = now;
  const unverified = Boolean(configured && user && !user.emailVerified);

  const holdUntil = Math.max(waitUntil, (verificationSentAt || 0) + RESEND_COOLDOWN_MS);
  const secondsLeft = Math.max(0, Math.ceil((holdUntil - now) / 1000));
  useEffect(() => {
    if (!unverified || secondsLeft === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [unverified, secondsLeft]);

  // Watch for the link being opened elsewhere. refreshUser refreshes the
  // token and hands the tabs a new user object, which makes them load again.
  useEffect(() => {
    if (!unverified) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      if (Date.now() - (mountedAt.current ?? 0) > POLL_FOR_MS) return;
      try {
        if (!cancelled) await refreshUser();
      } catch { /* try again next tick */ }
    };
    const timer = setInterval(tick, POLL_MS);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void tick(); });
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unverified]);

  if (!unverified || !user) return null;

  const check = async () => {
    setBusy(true);
    setStatus('');
    try {
      const refreshed = await refreshUser();
      if (!refreshed?.emailVerified) {
        setStatus('Not verified yet. Open the link in the newest email; this screen updates on its own.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not check just now.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (secondsLeft > 0) return;
    setBusy(true);
    setStatus('');
    try {
      await resendVerification();
      setStatus(`Sent to ${user.email}. Older links stop working once a new one is sent.`);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/too-many-requests') {
        setWaitUntil(Date.now() + 2 * RESEND_COOLDOWN_MS);
        setNow(Date.now());
        setStatus('Firebase is limiting resends for a few minutes. The email it already sent is probably in Junk.');
      } else {
        setStatus(error instanceof Error ? error.message : 'Could not send the email.');
      }
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
        We sent a link to {user.email} from noreply@planner.chanakyachowdary.in. University mail usually
        files it under <Text style={s.strong}>Junk</Text>. The planner stays read-only until the link is opened.
      </Text>
      <View style={s.actions}>
        <Pressable onPress={resend} disabled={busy || secondsLeft > 0} accessibilityRole="button">
          <Text style={[s.action, { color: secondsLeft > 0 ? colors.textMuted : colors.text }]}>
            {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend'}
          </Text>
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
