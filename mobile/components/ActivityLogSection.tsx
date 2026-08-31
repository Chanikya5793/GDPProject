import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { clearLogs, getLogs } from '@/api/logs';
import { revertLog } from '@/api/activity';
import { canRevert, describeRevert } from '@/utils/activityRevert';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { LogEntry } from '@/types';

// Mirrors the web Activity Log (src/components/ActivityLog.jsx): a session-grouped
// history of changes, each rollbackable where the snapshot allows it.

const VISIBLE_LIMIT = 25;

const ACTION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  created: 'add-circle-outline',
  updated: 'create-outline',
  deleted: 'trash-outline',
  completed: 'checkmark-circle-outline',
  reopened: 'refresh-outline',
  reverted: 'arrow-undo-outline',
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ActivityLogSection() {
  const { colors, accent, appearance } = useAppTheme();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const s = makeStyles(colors, appearance);

  const reload = useCallback(() => {
    getLogs().then(setLogs).catch(() => setLogs([]));
  }, []);

  // Refetch on focus: entries are written from the other tabs, so a value read
  // once at mount would be stale by the time this screen is opened again.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const handleRevert = (entry: LogEntry) => {
    Alert.alert('Roll back this change?', describeRevert(entry), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Roll back',
        style: 'destructive',
        onPress: async () => {
          const result = await revertLog(entry);
          if (!result.ok) Alert.alert('Could not roll back', result.reason);
          reload();
        },
      },
    ]);
  };

  const handleClear = () => {
    Alert.alert('Clear activity log?', 'This removes the history. Your planner data is untouched.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => { await clearLogs(); reload(); },
      },
    ]);
  };

  const visible = expanded ? logs : logs.slice(0, VISIBLE_LIMIT);

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name="time-outline" size={18} color={colors.text} />
        <Text style={s.sectionTitle}>Activity Log</Text>
        {logs.length > 0 && <Text style={s.count}>{logs.length}</Text>}
      </View>

      <Text style={s.blurb}>
        A history of changes you make. Expand an entry to roll it back.
      </Text>

      {logs.length === 0 ? (
        <Text style={s.empty}>No activity recorded yet.</Text>
      ) : (
        <>
          {visible.map(entry => {
            const revertable = canRevert(entry);
            return (
              <View key={entry.id} style={s.row}>
                <Ionicons
                  name={ACTION_ICON[entry.action] || 'ellipse-outline'}
                  size={16}
                  color={entry.reverted ? colors.textMuted : accent.primary}
                />
                <View style={s.rowBody}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {entry.action} {entry.entity}
                    {entry.title ? ` · ${entry.title}` : ''}
                  </Text>
                  <Text style={s.rowMeta}>
                    {relativeTime(entry.ts)}
                    {entry.reverted ? ' · rolled back' : ''}
                  </Text>
                </View>
                {revertable && (
                  <TouchableOpacity
                    onPress={() => handleRevert(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={`Roll back ${entry.action} ${entry.entity}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[s.rollback, { color: accent.primary }]}>Roll back</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {logs.length > VISIBLE_LIMIT && (
            <TouchableOpacity onPress={() => setExpanded(value => !value)} accessibilityRole="button">
              <Text style={[s.more, { color: accent.primary }]}>
                {expanded ? 'Show less' : `Show all ${logs.length}`}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.actionRow} onPress={handleClear} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color="#DC2626" />
            <Text style={[s.actionText, { color: '#DC2626' }]}>Clear activity log</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], appearance: ReturnType<typeof useAppTheme>['appearance']) {
  return createStyles(appearance)({
    section: {
      backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    count: { fontSize: 12, color: colors.textMuted },
    blurb: { fontSize: 12, color: colors.textMuted, marginBottom: 8, lineHeight: 17 },
    empty: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: 14, color: colors.text, textTransform: 'capitalize' },
    rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    rollback: { fontSize: 13, fontWeight: '600' },
    more: { fontSize: 13, fontWeight: '600', paddingVertical: 10 },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4,
    },
    actionText: { fontSize: 15, fontWeight: '600' },
  });
}
