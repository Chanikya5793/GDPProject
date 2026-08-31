import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { emptyTrash, getTrash, permanentDelete, restoreFromTrash } from '@/api/trash';
import { restoreNoteDirect } from '@/api/notes';
import { restoreReminderDirect } from '@/api/reminders';
import { restoreTaskDirect } from '@/api/tasks';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import {
  countByType, deletedAgo, filterTrash, TRASH_FILTERS, TrashFilter,
} from '@/utils/trashView';
import { TrashItem } from '@/types';

// Mirrors the web Recycle Bin (Settings → Recycle Bin): deleted tasks, reminders,
// and notes are held here until restored or permanently removed. The mobile app
// already had the trash API; it had no way to see or act on any of it.

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  task: 'checkbox-outline',
  reminder: 'notifications-outline',
  note: 'document-text-outline',
};

export default function RecycleBinSection({ userId }: { userId: string }) {
  const { colors, accent, appearance } = useAppTheme();
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [filter, setFilter] = useState<TrashFilter>('all');
  const s = makeStyles(colors, appearance);

  const reload = useCallback(() => {
    getTrash(userId).then(setTrash).catch(() => setTrash([]));
  }, [userId]);

  // Items are deleted from the other tabs, so a read at mount would be stale by
  // the time this screen is opened again.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const filtered = useMemo(() => filterTrash(trash, filter), [trash, filter]);

  const handleRestore = async (item: TrashItem) => {
    const result = await restoreFromTrash(item._trashId);
    if (!result) { reload(); return; }
    // Restore by the type recorded on the trash entry, not the active filter.
    if (result.type === 'task') await restoreTaskDirect(result.item as never);
    else if (result.type === 'reminder') await restoreReminderDirect(result.item as never);
    else if (result.type === 'note') await restoreNoteDirect(result.item as never);
    reload();
  };

  const handleDelete = (item: TrashItem) => {
    Alert.alert('Delete permanently?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => { await permanentDelete(item._trashId); reload(); },
      },
    ]);
  };

  const handleEmpty = () => {
    Alert.alert('Empty the recycle bin?', `This permanently deletes ${trash.length} item${trash.length === 1 ? '' : 's'}. It cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty',
        style: 'destructive',
        onPress: async () => { await emptyTrash(userId); reload(); },
      },
    ]);
  };

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name="trash-bin-outline" size={18} color={colors.text} />
        <Text style={s.sectionTitle}>Recycle Bin</Text>
        {trash.length > 0 && <Text style={s.count}>{trash.length}</Text>}
      </View>

      <Text style={s.blurb}>
        Deleted tasks, reminders, and notes are kept here. Restore them, or remove them for good.
      </Text>

      {trash.length > 0 && (
        <View style={s.filters}>
          {TRASH_FILTERS.map(option => {
            const active = filter === option.value;
            const count = countByType(trash, option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[s.pill, active && { backgroundColor: accent.primary }]}
                onPress={() => setFilter(option.value)}
                accessibilityRole="button"
                accessibilityLabel={`${option.label} (${count})`}
              >
                <Text style={[s.pillText, active && { color: '#FFF' }]}>
                  {option.label} {count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {filtered.length === 0 ? (
        <Text style={s.empty}>
          {trash.length === 0 ? 'The recycle bin is empty.' : 'Nothing deleted of this type.'}
        </Text>
      ) : (
        filtered.map(item => (
          <View key={String(item._trashId)} style={s.row}>
            <Ionicons
              name={TYPE_ICON[item._trashType] || 'ellipse-outline'}
              size={16}
              color={colors.textMuted}
            />
            <View style={s.rowBody}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {String(item.title || 'Untitled')}
              </Text>
              <Text style={s.rowMeta}>
                {item._trashType} · deleted {deletedAgo(item._deletedAt)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleRestore(item)}
              accessibilityRole="button"
              accessibilityLabel={`Restore ${item.title || 'item'}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.action, { color: accent.primary }]}>Restore</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item)}
              accessibilityRole="button"
              accessibilityLabel={`Permanently delete ${item.title || 'item'}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color="#DC2626" />
            </TouchableOpacity>
          </View>
        ))
      )}

      {trash.length > 0 && (
        <TouchableOpacity style={s.actionRow} onPress={handleEmpty} accessibilityRole="button">
          <Ionicons name="warning-outline" size={18} color="#DC2626" />
          <Text style={[s.actionText, { color: '#DC2626' }]}>Empty recycle bin</Text>
        </TouchableOpacity>
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
    blurb: { fontSize: 12, color: colors.textMuted, marginBottom: 10, lineHeight: 17 },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    pill: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
      backgroundColor: colors.surfaceVariant,
    },
    pillText: { fontSize: 12, color: colors.text, fontWeight: '600' },
    empty: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: 14, color: colors.text },
    rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },
    action: { fontSize: 13, fontWeight: '600' },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    actionText: { fontSize: 15, fontWeight: '600' },
  });
}
