import { useCallback } from 'react';
import { Linking, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/components/Toast';

/** Kept in step by hand with the `widgets` array under expo-widgets in app.json. */
const WIDGETS: { name: string; where: string; blurb: string }[] = [
  {
    name: 'Due Today',
    where: 'Home screen · Lock Screen',
    blurb: 'How much is due, and what is next. Choose today, three days or the week.',
  },
  {
    name: 'Up Next',
    where: 'Home screen · Lock Screen',
    blurb: 'The next thing, counting down. Tick it off without opening the app.',
  },
  {
    name: 'This Week',
    where: 'Home screen',
    blurb: 'A bar per day, so you can see which day is worth protecting.',
  },
  {
    name: 'Today’s Progress',
    where: 'Lock Screen',
    blurb: 'A ring of what you have finished today.',
  },
];

/** Kept in step by hand with PlannerAppShortcuts in plugins/withSiriShortcuts.js. */
const PHRASES: { say: string; does: string }[] = [
  { say: '“Add a task to NW Planner”', does: 'Opens the form. You can say a due date, a priority and a category too.' },
  { say: '“Add a reminder to NW Planner”', does: 'Same, for reminders.' },
  { say: '“What’s due today in NW Planner”', does: 'Answers out loud. Counts and times only — never what a task is called.' },
  { say: '“Show my day in NW Planner”', does: 'Opens the planner. Pick any screen in the Shortcuts app.' },
];

/**
 * Everything the planner does outside the app, and the one privacy decision
 * behind it.
 *
 * Widgets and Siri are invisible features — nobody discovers a Lock Screen
 * widget or guesses a phrase — so this section exists mostly to say they are
 * there and how to reach them.
 */
export default function WidgetsSiriSection() {
  const { colors, accent, appearance } = useAppTheme();
  const { settings, updateSetting } = useSettings();
  const toast = useToast();
  const s = makeStyles(colors, appearance);

  const setWidgetTitles = useCallback((value: boolean) => {
    updateSetting('widgetShowTitles', value);
    // Deliberately warned about rather than confirmed away: the cost is that
    // titles leave the encrypted store for a container the widget process can
    // read, and the student is the only one who can weigh that.
    toast.show(
      value
        ? 'Titles can now appear on the Lock Screen'
        : 'Widgets are back to counts and times only',
      'info',
    );
  }, [updateSetting, toast]);

  const openShortcuts = useCallback(() => {
    Linking.openURL('shortcuts://').catch(() => {
      toast.show('The Shortcuts app is not available on this device', 'info');
    });
  }, [toast]);

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name="grid-outline" size={18} color={accent.primary} />
        <Text style={s.sectionTitle}>Widgets &amp; Siri</Text>
      </View>
      <Text style={s.blurb}>
        Built from what is already stored on this device. Nothing about your work
        is sent anywhere to put it on the home screen or answer a question.
      </Text>

      <Text style={s.groupLabel}>Widgets</Text>
      {WIDGETS.map(widget => (
        <View key={widget.name} style={s.row}>
          <View style={s.rowInfo}>
            <Text style={s.rowLabel}>{widget.name}</Text>
            <Text style={s.rowDesc}>{widget.blurb}</Text>
          </View>
          <Text style={s.where}>{widget.where}</Text>
        </View>
      ))}
      <Text style={s.hint}>
        To add one, press and hold the home screen, tap the add button and search
        for NW Planner. Press and hold a widget you have added to change what it
        shows — that needs iOS 17 or later.
      </Text>

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Allow Titles on Widgets</Text>
          <Text style={s.rowDesc}>
            Off by default, widgets show only counts and times. Turning this on
            lets them show what a task is called — including on the Lock Screen,
            which is readable without unlocking the phone. Each widget can still
            hide titles on its own.
          </Text>
        </View>
        <Switch
          value={settings.widgetShowTitles}
          onValueChange={setWidgetTitles}
          trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
          thumbColor={Platform.OS === 'android'
            ? (settings.widgetShowTitles ? accent.light : '#f4f3f4')
            : undefined}
        />
      </View>

      <Text style={s.groupLabel}>Say to Siri</Text>
      {PHRASES.map(phrase => (
        <View key={phrase.say} style={s.stackRow}>
          <Text style={s.phrase}>{phrase.say}</Text>
          <Text style={s.rowDesc}>{phrase.does}</Text>
        </View>
      ))}

      <TouchableOpacity style={s.actionRow} onPress={openShortcuts} accessibilityRole="button">
        <Ionicons name="open-outline" size={16} color={accent.primary} />
        <Text style={[s.actionText, { color: accent.primary }]}>
          Build your own in the Shortcuts app
        </Text>
      </TouchableOpacity>

      <Text style={s.footnote}>
        Adding a task by voice opens the app so the record is written the same
        way a typed one is — encrypted, logged, and queued if you are offline.
        Asking what is due answers without opening anything.
      </Text>
    </View>
  );
}

function makeStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  appearance: ReturnType<typeof useAppTheme>['appearance'],
) {
  return createStyles(appearance)({
    section: {
      backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    blurb: { fontSize: 12, color: colors.textMuted, marginBottom: 6, lineHeight: 17 },
    groupLabel: {
      fontSize: 11, fontWeight: '700', color: colors.textSecondary,
      letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 2,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    stackRow: {
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    rowInfo: { flex: 1 },
    rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    rowDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    where: { fontSize: 10, color: colors.textSecondary, maxWidth: 92, textAlign: 'right' },
    phrase: { fontSize: 14, fontWeight: '600', color: colors.text },
    hint: { fontSize: 11, color: colors.textMuted, marginTop: 10, lineHeight: 16 },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    actionText: { fontSize: 13, fontWeight: '700' },
    footnote: { fontSize: 11, color: colors.textMuted, marginTop: 12, lineHeight: 16 },
  });
}
