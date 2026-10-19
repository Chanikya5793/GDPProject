import { useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import {
  dismissPlannerSyncConflict, getPlannerSyncConflicts, onPlannerSyncChanged,
  recoverPlannerSyncConflict, refreshPlannerData, type PlannerSyncConflict,
} from '@/api/plannerClient';
import { getStorageUid } from '@/api/storage';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { useToast } from './Toast';

export default function SyncConflictsSection() {
  const { user } = useAuth();
  const { colors, accent } = useAppTheme();
  const toast = useToast();
  const [items, setItems] = useState<PlannerSyncConflict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setItems([]);
    const read = () => {
      void getPlannerSyncConflicts().then(records => {
        if (active && getStorageUid() === user?.id) setItems(records);
      }).catch(() => {});
    };
    read();
    const stop = onPlannerSyncChanged(read);
    return () => { active = false; stop(); };
  }, [user?.id]);
  if (!user || !items.length) return null;
  const act = async (item: PlannerSyncConflict, recover: boolean) => {
    setBusy(item.id);
    try {
      if (recover) await recoverPlannerSyncConflict(item.id);
      else await dismissPlannerSyncConflict(item.id);
      if (getStorageUid() !== user.id) return;
      setItems(await getPlannerSyncConflicts());
      await refreshPlannerData(true);
      toast.show(recover ? 'Saved change restored as a separate copy.' : 'Saved change dismissed.', 'info');
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Please try again.', 'error'); }
    finally { setBusy(null); }
  };
  return (
    <View style={{ padding: 20, backgroundColor: colors.card, borderRadius: 16, gap: 12, marginBottom: 16 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Saved changes to review</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
        These offline changes were refused by the cloud, often because an item changed on another device.
        The cloud version is shown in your planner. Your saved version is kept here.
      </Text>
      {items.map(item => (
        <View key={item.id} style={{ gap: 4 }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {String(item.content?.title ?? `${item.method === 'DELETE' ? 'Delete' : 'Update'} ${item.kind}`)}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {new Date(item.savedAt).toLocaleString()}
            {item.content?.completed === true ? ' · Saved as completed' : ''}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => router.push({ pathname: item.kind === 'task' ? '/(tabs)/tasks' : item.kind === 'reminder' ? '/(tabs)/reminders' : '/(tabs)/notes', params: { focus: String(item.recordId) } })}>
              <Text style={{ color: accent.primary }}>Open cloud item</Text>
            </TouchableOpacity>
            {item.content && <TouchableOpacity disabled={busy !== null} accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { void act(item, true); }}>
              <Text style={{ color: accent.primary }}>{busy === item.id ? 'Restoring…' : 'Restore as new item'}</Text>
            </TouchableOpacity>}
            <TouchableOpacity disabled={busy !== null} accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => Alert.alert('Dismiss saved change?',
                'The cloud item will stay as it is. This saved offline change will be removed.',
                [{ text: 'Cancel', style: 'cancel' }, { text: 'Dismiss', style: 'destructive', onPress: () => { void act(item, false); } }])}>
              <Text style={{ color: colors.textSecondary }}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}
