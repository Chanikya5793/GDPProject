import { useCallback, useState } from 'react';
import { Linking, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/components/Toast';
import { nativeWidgetsAvailable, syncWidget } from '@/api/widgets';

/** Kept in step by hand with the `widgets` array under expo-widgets in app.json. */
const WIDGETS: { name: string; where: string; blurb: string }[] = [
  {
    name: 'Due Today',
    where: 'Home screen · Lock Screen',
    blurb: 'Your interactive agenda. Complete work, browse the whole list, and see deadlines and priority. Small, medium and large sizes.',
  },
  {
    name: 'Up Next',
    where: 'Home screen · Lock Screen',
    blurb: 'A live deadline countdown, priority, and what comes after it. Check off tasks and reminders from the widget.',
  },
  {
    name: 'This Week',
    where: 'Home screen',
    blurb: 'Tap a day to explore its workload. The large widget includes that day’s agenda. Red marks high priority work.',
  },
  {
    name: 'Today’s Progress',
    where: 'Home screen · Lock Screen',
    blurb: 'Progress for items due today, with overdue and unscheduled work on the medium Home Screen widget.',
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
  const [refreshing, setRefreshing] = useState(false);
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

  const refreshWidgets = useCallback(async () => {
    if (!nativeWidgetsAvailable()) {
      toast.show('Install the updated iOS app to use native widgets.', 'info');
      return;
    }
    setRefreshing(true);
    try {
      await syncWidget();
      toast.show('Widget refresh requested. iOS controls when it appears.', 'info');
    } catch {
      toast.show('Could not refresh widgets. Try again after opening your planner.', 'info');
    } finally { setRefreshing(false); }
  }, [toast]);

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name="grid-outline" size={18} color={accent.primary} />
        <Text style={s.sectionTitle}>Widgets &amp; Siri</Text>
      </View>
      <Text style={s.blurb}>
        Keep your agenda, deadlines and progress within reach. Widget checkboxes
        save on this device, even while the app is closed. Open the planner to
        apply those changes and sync them to your account.
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
        shows. Interactive widgets need iOS 17 or later. Large widgets have room
        for more information; iPad also supports an extra-large agenda.
      </Text>

      <Text style={s.hint}>
        In Edit Widget, choose tasks, reminders, or both; sort by deadline or
        priority; include overdue or unscheduled work; and pick an accent.
        Tap a title to open that record. Use Undo while a completion is waiting
        to sync. Dates without a time stay all-day until the day ends.
      </Text>

      {Platform.OS === 'ios' && (
        <TouchableOpacity style={s.actionRow} onPress={refreshWidgets} disabled={refreshing}
          accessibilityRole="button" accessibilityState={{ disabled: refreshing }}>
          <Ionicons name="refresh-outline" size={16} color={accent.primary} />
          <Text style={[s.actionText, { color: accent.primary }]}>
            {refreshing ? 'Refreshing widgets…' : 'Refresh widgets now'}
          </Text>
        </TouchableOpacity>
      )}

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Show task and reminder titles</Text>
          <Text style={s.rowDesc}>
            On by default. Titles and categories are copied to shared device storage
            so widgets can show them, which means they may appear on your Lock Screen.
            Notes and attachments stay private. Turn off for counts and times only;
            configurable widgets can also hide titles in Edit Widget.
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
