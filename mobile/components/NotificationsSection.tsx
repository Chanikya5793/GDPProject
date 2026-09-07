import { useCallback, useEffect, useState } from 'react';
import {
  AppState, Linking, Platform, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/components/Toast';
import {
  hasNotificationPermission, requestNotificationPermission, syncScheduledNotifications,
} from '@/api/notifications';

/** Lead times offered for a task with a due time. */
const LEAD_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: 'On time' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 1440, label: '1d' },
];

type Permission = 'unknown' | 'granted' | 'denied';

/**
 * Alerts and the home screen widget, and the truthful version of whether they
 * are on.
 *
 * The app's own switch is only half the answer: iOS can be refusing to deliver
 * anything regardless of what the switch says, and a settings screen that shows
 * "Due Date Alerts: on" while the system silently drops every one of them is
 * worse than having no switch at all. So permission is read on mount and every
 * time the app comes back to the foreground — which is how a student returning
 * from the iOS Settings app sees this section update.
 */
export default function NotificationsSection() {
  const { colors, accent, appearance } = useAppTheme();
  const { settings, updateSetting } = useSettings();
  const toast = useToast();
  const [permission, setPermission] = useState<Permission>('unknown');
  const s = makeStyles(colors, appearance);

  const refresh = useCallback(() => {
    hasNotificationPermission()
      .then(granted => setPermission(granted ? 'granted' : 'denied'))
      .catch(() => setPermission('denied'));
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const enable = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) {
      await syncScheduledNotifications();
      toast.show('Alerts on for this device', 'success');
    } else {
      // iOS only prompts once ever. After that the only way back is the system
      // Settings app, so say that rather than letting the button do nothing.
      toast.show('Allow notifications in iOS Settings to get alerts', 'info');
      Linking.openSettings().catch(() => {});
    }
  }, [toast]);

  const setSwitch = useCallback((value: boolean) => {
    updateSetting('dueDateAlerts', value);
  }, [updateSetting]);

  const setLead = useCallback((minutes: number) => {
    updateSetting('reminderDefault', minutes);
  }, [updateSetting]);

  // Deliberately warned about rather than confirmed away: the cost is that
  // titles leave the encrypted store for a container the widget process can
  // read, and the student is the only one who can weigh that.
  const setWidgetTitles = useCallback((value: boolean) => {
    updateSetting('widgetShowTitles', value);
    if (value) toast.show('Widget titles are visible on the Lock Screen', 'info');
  }, [updateSetting, toast]);

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name="notifications-outline" size={18} color={accent.primary} />
        <Text style={s.sectionTitle}>Notifications &amp; Widget</Text>
      </View>
      <Text style={s.blurb}>
        Scheduled on this device from what is already stored here. Nothing about
        your tasks is sent anywhere to make an alert appear.
      </Text>

      {permission !== 'granted' && (
        <TouchableOpacity style={s.enableRow} onPress={enable} accessibilityRole="button">
          <Ionicons name="lock-open-outline" size={16} color={accent.primary} />
          <Text style={[s.enableText, { color: accent.primary }]}>
            {permission === 'denied'
              ? 'Notifications are off for this app — turn them on'
              : 'Allow notifications'}
          </Text>
        </TouchableOpacity>
      )}

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Due Date Alerts</Text>
          <Text style={s.rowDesc}>
            A nudge before a task with a due time. Reminders always alert at the
            time you set.
          </Text>
        </View>
        <Switch
          value={settings.dueDateAlerts}
          onValueChange={setSwitch}
          trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
          thumbColor={Platform.OS === 'android'
            ? (settings.dueDateAlerts ? accent.light : '#f4f3f4')
            : undefined}
        />
      </View>

      <View style={s.stackRow}>
        <Text style={s.rowLabel}>Alert me before</Text>
        <Text style={s.rowDesc}>How far ahead of a due time a task alerts.</Text>
        <View style={s.pills}>
          {LEAD_CHOICES.map(choice => {
            const active = settings.reminderDefault === choice.value;
            return (
              <TouchableOpacity
                key={choice.value}
                style={[
                  s.pill,
                  active && { backgroundColor: accent.primary },
                  !settings.dueDateAlerts && s.pillDisabled,
                ]}
                disabled={!settings.dueDateAlerts}
                onPress={() => setLead(choice.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Alert ${choice.label} before a task is due`}
              >
                <Text style={[s.pillText, active && { color: '#FFF' }]}>{choice.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Show Titles on the Widget</Text>
          <Text style={s.rowDesc}>
            Off by default, the widget shows only counts and times. Turning this
            on puts what a task is called on the home screen — and on the Lock
            Screen, which is readable without unlocking the phone.
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

      <Text style={s.footnote}>
        iOS holds a limited number of pending alerts, so the nearest ones are
        scheduled first and the rest follow as those pass. Signing out clears
        every alert and empties the widget.
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
    enableRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    enableText: { fontSize: 13, fontWeight: '700', flex: 1 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    stackRow: {
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    rowInfo: { flex: 1 },
    rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    rowDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    pill: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
      backgroundColor: colors.surfaceVariant,
    },
    pillDisabled: { opacity: 0.45 },
    pillText: { fontSize: 12, color: colors.text, fontWeight: '600' },
    footnote: { fontSize: 11, color: colors.textMuted, marginTop: 10, lineHeight: 16 },
  });
}
