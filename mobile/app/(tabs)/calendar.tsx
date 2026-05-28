import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getTasks, toggleTask } from '@/api/tasks';
import { getReminders } from '@/api/reminders';
import { Task, Reminder } from '@/types';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

type CalItem = (Task & { _type: 'task' }) | (Reminder & { _type: 'reminder' });

export default function CalendarScreen() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { colors, accent } = useAppTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const todayStr = localDateStr();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [t, r] = await Promise.all([getTasks(user.id), getReminders(user.id)]);
    setTasks(t);
    setReminders(r);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleToggle = async (id: number) => {
    const updated = await toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  };

  const goBack = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const goForward = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const goToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
    setSelectedDate(todayStr);
  };

  // Build items by date
  const itemsByDate: Record<string, CalItem[]> = {};
  for (const t of tasks) {
    if (!t.dueDate) continue;
    if (!itemsByDate[t.dueDate]) itemsByDate[t.dueDate] = [];
    itemsByDate[t.dueDate].push({ ...t, _type: 'task' });
  }
  for (const r of reminders) {
    if (!r.date) continue;
    if (!itemsByDate[r.date]) itemsByDate[r.date] = [];
    itemsByDate[r.date].push({ ...r, _type: 'reminder' });
  }

  // Month grid
  const startOffset = settings.weekStartsOn === 'monday' ? 1 : 0;
  const rawFirst = new Date(year, month, 1).getDay();
  const firstDay = (rawFirst - startOffset + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayHeaders = startOffset === 1
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedItems = itemsByDate[selectedDate] || [];
  const selectedTasks = selectedItems.filter(i => i._type === 'task') as (Task & { _type: 'task' })[];
  const selectedReminders = selectedItems.filter(i => i._type === 'reminder') as (Reminder & { _type: 'reminder' })[];

  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const s = makeStyles(colors, accent);

  return (
    <View style={s.container}>
      {/* Nav */}
      <View style={s.nav}>
        <TouchableOpacity onPress={goToday} style={[s.todayBtn, { borderColor: accent.primary }]}>
          <Text style={[s.todayBtnText, { color: accent.primary }]}>Today</Text>
        </TouchableOpacity>
        <View style={s.navCenter}>
          <TouchableOpacity onPress={goBack} style={s.navArrow}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.navTitle}>{monthName}</Text>
          <TouchableOpacity onPress={goForward} style={s.navArrow}>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
      >
        {/* Day headers */}
        <View style={s.dayHeaderRow}>
          {dayHeaders.map((d, i) => (
            <View key={i} style={s.dayHeaderCell}>
              <Text style={s.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Grid */}
        <View style={s.grid}>
          {cells.map((day, i) => {
            if (day === null) return <View key={`e-${i}`} style={s.cell} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const items = itemsByDate[dateStr] || [];
            const hasTask = items.some(i => i._type === 'task');
            const hasReminder = items.some(i => i._type === 'reminder');

            return (
              <TouchableOpacity
                key={dateStr}
                style={[s.cell, isSelected && { backgroundColor: accent.surface }]}
                onPress={() => setSelectedDate(dateStr)}
                activeOpacity={0.6}
              >
                <View style={[
                  s.dayNum,
                  isToday && { backgroundColor: accent.primary },
                ]}>
                  <Text style={[
                    s.dayNumText,
                    { color: isToday ? '#FFF' : colors.text },
                    isSelected && !isToday && { color: accent.primary, fontWeight: '700' },
                  ]}>{day}</Text>
                </View>
                <View style={s.dots}>
                  {hasTask && <View style={[s.dot, { backgroundColor: accent.primary }]} />}
                  {hasReminder && <View style={[s.dot, { backgroundColor: colors.warning }]} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Selected day panel */}
        <View style={[s.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={s.panelDate}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>

          {selectedItems.length === 0 ? (
            <Text style={s.panelEmpty}>Nothing scheduled for this day.</Text>
          ) : (
            <>
              {selectedTasks.map(task => (
                <TouchableOpacity
                  key={task.id}
                  style={[s.panelItem, { borderLeftColor: accent.primary }]}
                  onPress={() => handleToggle(task.id)}
                >
                  <View style={[s.panelCheck, {
                    borderColor: task.completed ? accent.primary : colors.textMuted,
                    backgroundColor: task.completed ? accent.primary : 'transparent',
                  }]}>
                    {task.completed && <Ionicons name="checkmark" size={10} color="#FFF" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.panelItemTitle, {
                      color: task.completed ? colors.textMuted : colors.text,
                      textDecorationLine: task.completed ? 'line-through' : 'none',
                    }]}>{task.title}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {task.dueTime ? <Text style={s.panelMeta}>{formatTime(task.dueTime)}</Text> : null}
                      {task.category ? <Text style={s.panelMeta}>{task.category}</Text> : null}
                      <Text style={[s.panelBadge, {
                        color: task.priority === 'high' ? colors.error : task.priority === 'low' ? colors.success : colors.warning,
                      }]}>{task.priority}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {selectedReminders.map(rem => (
                <View key={rem.id} style={[s.panelItem, { borderLeftColor: colors.warning }]}>
                  <Ionicons name="notifications" size={16} color={colors.warning} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={[s.panelItemTitle, { color: colors.text }]}>{rem.title}</Text>
                    {rem.time ? <Text style={s.panelMeta}>{formatTime(rem.time)}</Text> : null}
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
    todayBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, width: 60, alignItems: 'center' },
    todayBtnText: { fontSize: 13, fontWeight: '600' },
    navCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    navArrow: { padding: 4 },
    navTitle: { fontSize: 17, fontWeight: '600', color: colors.text, minWidth: 160, textAlign: 'center' },
    dayHeaderRow: { flexDirection: 'row', paddingHorizontal: 8 },
    dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
    dayHeaderText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
    cell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2, borderRadius: 8 },
    dayNum: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    dayNumText: { fontSize: 15, fontWeight: '500' },
    dots: { flexDirection: 'row', gap: 3, marginTop: 2, height: 6 },
    dot: { width: 5, height: 5, borderRadius: 2.5 },
    panel: { margin: 16, borderRadius: 14, borderWidth: 1, padding: 16 },
    panelDate: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },
    panelEmpty: { fontSize: 14, color: colors.textMuted },
    panelItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderLeftWidth: 3, backgroundColor: colors.card, borderRadius: 8, marginBottom: 8, gap: 10 },
    panelCheck: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    panelItemTitle: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
    panelMeta: { fontSize: 12, color: colors.textMuted },
    panelBadge: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  });
}
