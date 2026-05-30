import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Modal, RefreshControl, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getReminders, createReminder, updateReminder, deleteReminder } from '@/api/reminders';
import { Reminder } from '@/types';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatGroupDate(dateStr: string) {
  const todayStr = localDateStr();
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return dateStr === todayStr ? `Today — ${label}` : label;
}

export default function RemindersScreen() {
  const { user } = useAuth();
  const { colors, accent } = useAppTheme();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRem, setEditingRem] = useState<Reminder | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    const r = await getReminders(user.id);
    setReminders(r);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleSave = async (form: Partial<Reminder>) => {
    if (editingRem) {
      const updated = await updateReminder(editingRem.id, form);
      setReminders(prev => prev.map(r => r.id === editingRem.id ? updated : r));
    } else {
      const created = await createReminder({ ...form, userId: user!.id, title: form.title || '' });
      setReminders(prev => [...prev, created]);
    }
    setModalVisible(false);
    setEditingRem(null);
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Reminder', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteReminder(id);
        setReminders(prev => prev.filter(r => r.id !== id));
      }},
    ]);
  };

  const todayStr = localDateStr();
  let filtered = [...reminders];
  if (filter === 'upcoming') filtered = filtered.filter(r => r.date >= todayStr);
  if (filter === 'past') filtered = filtered.filter(r => r.date < todayStr);
  filtered.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));

  // Group by date
  const groups: { date: string; items: Reminder[] }[] = [];
  let lastDate = '';
  for (const rem of filtered) {
    if (rem.date !== lastDate) {
      groups.push({ date: rem.date, items: [rem] });
      lastDate = rem.date;
    } else {
      groups[groups.length - 1].items.push(rem);
    }
  }

  const totalToday = reminders.filter(r => r.date === todayStr).length;
  const totalUpcoming = reminders.filter(r => r.date > todayStr).length;

  const s = makeStyles(colors, accent);

  return (
    <View style={s.container}>
      <View style={s.headerBar}>
        <Text style={s.subtitle}>
          {totalToday > 0 ? `${totalToday} today · ` : ''}{totalUpcoming} upcoming
        </Text>
        <TouchableOpacity
          style={[s.addBtn, { backgroundColor: accent.primary }]}
          onPress={() => { setEditingRem(null); setModalVisible(true); }}
        >
          <Ionicons name="add" size={20} color="#FFF" />
          <Text style={s.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {(['upcoming', 'past', 'all'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[s.filterPill, filter === f && { backgroundColor: accent.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterText, filter === f && { color: '#FFF' }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
      >
        {groups.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="notifications-outline" size={48} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No reminders</Text>
            <Text style={s.emptyText}>Add a reminder to get started.</Text>
          </View>
        ) : (
          groups.map(group => {
            const isOverdue = group.date < todayStr;
            const isToday = group.date === todayStr;
            return (
              <View key={group.date}>
                <Text style={[s.groupLabel, {
                  color: isOverdue ? colors.error : isToday ? accent.primary : colors.textSecondary,
                }]}>
                  {isOverdue ? '⚠ ' : ''}{formatGroupDate(group.date)}
                </Text>
                {group.items.map(rem => (
                  <View key={rem.id} style={[s.card, {
                    backgroundColor: colors.card,
                    borderColor: isOverdue ? colors.error : colors.border,
                    borderLeftWidth: isOverdue ? 3 : 1,
                    borderLeftColor: isOverdue ? colors.error : colors.border,
                  }]}>
                    <View style={[s.bellWrap, { backgroundColor: accent.surface }]}>
                      <Ionicons name="notifications" size={18} color={accent.primary} />
                    </View>
                    <View style={s.cardBody}>
                      <Text style={[s.cardTitle, { color: colors.text }]}>{rem.title}</Text>
                      <Text style={[s.cardTime, { color: colors.textMuted }]}>
                        {formatTime(rem.time) || 'No time set'}
                      </Text>
                      {rem.notes ? <Text style={[s.cardNotes, { color: colors.textMuted }]} numberOfLines={2}>{rem.notes}</Text> : null}
                    </View>
                    <View style={s.cardActions}>
                      <TouchableOpacity onPress={() => { setEditingRem(rem); setModalVisible(true); }}>
                        <Ionicons name="pencil" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(rem.id)}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <ReminderModal
        visible={modalVisible}
        reminder={editingRem}
        colors={colors}
        accent={accent}
        onSave={handleSave}
        onClose={() => { setModalVisible(false); setEditingRem(null); }}
      />
    </View>
  );
}

function ReminderModal({ visible, reminder, colors, accent, onSave, onClose }: {
  visible: boolean;
  reminder: Reminder | null;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  onSave: (form: Partial<Reminder>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible) {
      setTitle(reminder?.title || '');
      setDate(reminder?.date || localDateStr());
      setTime(reminder?.time || '');
      setNotes(reminder?.notes || '');
    }
  }, [visible, reminder]);

  const ms = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    form: { padding: 20 },
    label: { fontSize: 14, fontWeight: '500', color: colors.textSecondary, marginBottom: 6, marginTop: 16 },
    input: { backgroundColor: colors.surfaceVariant, borderRadius: 10, padding: 14, fontSize: 16, color: colors.text, borderWidth: 1, borderColor: colors.border },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ms.container}>
        <View style={ms.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ fontSize: 16, color: colors.textSecondary }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={ms.headerTitle}>{reminder ? 'Edit Reminder' : 'New Reminder'}</Text>
          <TouchableOpacity onPress={() => { if (title.trim()) onSave({ title, date, time, notes }); }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: accent.primary }}>{reminder ? 'Save' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={ms.form} keyboardShouldPersistTaps="handled">
          <Text style={ms.label}>Title</Text>
          <TextInput style={ms.input} value={title} onChangeText={setTitle} placeholder="What to remember?" placeholderTextColor={colors.textMuted} autoFocus />
          <Text style={ms.label}>Date</Text>
          <TextInput style={ms.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
          <Text style={ms.label}>Time</Text>
          <TextInput style={ms.input} value={time} onChangeText={setTime} placeholder="HH:MM (24h)" placeholderTextColor={colors.textMuted} />
          <Text style={ms.label}>Notes</Text>
          <TextInput style={[ms.input, { height: 80, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="Details..." placeholderTextColor={colors.textMuted} multiline />
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
    subtitle: { fontSize: 13, color: colors.textSecondary },
    addBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 4 },
    addBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
    filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
    filterPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surfaceVariant },
    filterText: { fontSize: 13, fontWeight: '500', color: colors.text },
    list: { paddingHorizontal: 20 },
    groupLabel: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 },
    card: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8, gap: 12 },
    bellWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
    cardTime: { fontSize: 13 },
    cardNotes: { fontSize: 13, marginTop: 4 },
    cardActions: { gap: 12 },
    empty: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 12 },
    emptyText: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  });
}
