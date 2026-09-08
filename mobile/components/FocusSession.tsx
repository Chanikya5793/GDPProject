import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/components/Toast';
import {
  currentSession,
  endSession,
  extendCurrentSession,
  pauseCurrentSession,
  resumeCurrentSession,
  startSession,
} from '@/api/liveActivity';
import {
  formatRemaining,
  isFinished,
  SESSION_PRESETS,
  StudySessionProps,
} from '@/utils/studySession';

/**
 * Start a focus session, and watch it run.
 *
 * The card on the Lock Screen is the real interface — that is the point of the
 * feature — so this stays deliberately small: pick a length, then pause, add
 * time, or stop. The countdown here is redrawn once a second because a screen
 * the student is looking at should tick; the Lock Screen's version needs no
 * such help, since the system counts that one down itself.
 */
export default function FocusSession({ dueToday = 0 }: { dueToday?: number }) {
  const { colors, accent, appearance } = useAppTheme();
  const { settings } = useSettings();
  const toast = useToast();
  const [session, setSession] = useState<StudySessionProps | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finishedRef = useRef(false);
  const s = makeStyles(colors, accent, appearance);

  const refresh = useCallback(() => {
    currentSession().then(setSession).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // A session started before the app was killed is still running on the Lock
    // Screen, so the control has to find it again rather than offer to start.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { refresh(); setNow(Date.now()); }
    });
    return () => subscription.remove();
  }, [refresh]);

  const running = session !== null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Said once, when the timer actually runs out with the app open. The finished
  // card is left on the Lock Screen for a few minutes in either case, which is
  // how a student who walked away finds out.
  useEffect(() => {
    if (!session || finishedRef.current) return;
    if (!isFinished(session, now)) return;
    finishedRef.current = true;
    endSession(true).then(() => {
      setSession(null);
      toast.show('Focus session finished', 'success');
    }).catch(() => {});
  }, [session, now, toast]);

  const begin = useCallback(async (minutes: number) => {
    finishedRef.current = false;
    const started = await startSession({
      minutes,
      category: settings.defaultCategory,
      titlesAllowed: settings.widgetShowTitles,
      dueToday,
    });
    if (!started) {
      // Live Activities can be switched off per app, and starting one then
      // fails. Saying so beats a button that silently does nothing.
      toast.show('Turn on Live Activities for NW Planner in iOS Settings', 'info');
      return;
    }
    setSession(started);
    setNow(Date.now());
  }, [settings.defaultCategory, settings.widgetShowTitles, dueToday, toast]);

  const stop = useCallback(async () => {
    await endSession();
    setSession(null);
    toast.show('Focus session stopped', 'info');
  }, [toast]);

  if (!session) {
    return (
      <View style={s.card}>
        <View style={s.header}>
          <Ionicons name="book-outline" size={16} color={accent.primary} />
          <Text style={s.title}>Focus session</Text>
        </View>
        <Text style={s.blurb}>
          A countdown on your Lock Screen and in the Dynamic Island, so you can
          put the phone down.
        </Text>
        <View style={s.presets}>
          {SESSION_PRESETS.map(minutes => (
            <TouchableOpacity
              key={minutes}
              style={s.preset}
              onPress={() => begin(minutes)}
              accessibilityRole="button"
              accessibilityLabel={`Start a ${minutes} minute focus session`}
            >
              <Text style={s.presetText}>{minutes}m</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  const paused = session.pausedAt > 0;

  return (
    <View style={[s.card, s.cardRunning]}>
      <View style={s.header}>
        <Ionicons
          name={paused ? 'pause-circle' : 'book'}
          size={16}
          color={paused ? colors.textSecondary : accent.primary}
        />
        <Text style={s.title}>{paused ? 'Paused' : 'Focusing'}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.clock}>{formatRemaining(session, now)}</Text>
      </View>

      <View style={s.controls}>
        <TouchableOpacity
          style={s.control}
          onPress={async () => setSession(paused ? await resumeCurrentSession() : await pauseCurrentSession())}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume the session' : 'Pause the session'}
        >
          <Ionicons name={paused ? 'play' : 'pause'} size={15} color={accent.primary} />
          <Text style={s.controlText}>{paused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.control}
          onPress={async () => setSession(await extendCurrentSession(10))}
          accessibilityRole="button"
          accessibilityLabel="Add ten minutes"
        >
          <Ionicons name="add" size={15} color={accent.primary} />
          <Text style={s.controlText}>10m</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.control, s.stop]}
          onPress={stop}
          accessibilityRole="button"
          accessibilityLabel="Stop the session"
        >
          <Ionicons name="stop" size={15} color={colors.error} />
          <Text style={[s.controlText, { color: colors.error }]}>Stop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  accent: ReturnType<typeof useAppTheme>['accent'],
  appearance: ReturnType<typeof useAppTheme>['appearance'],
) {
  return createStyles(appearance)({
    card: {
      backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10,
      borderWidth: 1, borderColor: colors.border,
    },
    cardRunning: { borderColor: accent.primary },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 15, fontWeight: '600', color: colors.text },
    clock: {
      fontSize: 20, fontWeight: '700', color: accent.primary,
      fontVariant: ['tabular-nums'],
    },
    blurb: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    presets: { flexDirection: 'row', gap: 8 },
    preset: {
      flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9,
      backgroundColor: colors.surfaceVariant,
    },
    presetText: { fontSize: 14, fontWeight: '600', color: colors.text },
    controls: { flexDirection: 'row', gap: 8 },
    control: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 5, paddingVertical: 9, borderRadius: 9, backgroundColor: colors.surfaceVariant,
    },
    stop: { backgroundColor: colors.errorSurface },
    controlText: { fontSize: 13, fontWeight: '600', color: colors.text },
    dividerSpacer: { height: StyleSheet.hairlineWidth },
  });
}
