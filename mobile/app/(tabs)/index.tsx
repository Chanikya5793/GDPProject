import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Platform, Dimensions, LayoutAnimation,
} from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getTasks, toggleTask, createTask } from '@/api/tasks';
import { getReminders, createReminder } from '@/api/reminders';
import { Task, Reminder } from '@/types';

// ─── priority escalation (inline) ───────────────────────────────────────────
type EscalatedPriority = { effective: Task['priority']; original: Task['priority']; wasEscalated: boolean; daysUntilDue: number };
function getDaysUntilDueDash(dueDateStr: string): number {
  if (!dueDateStr) return Infinity;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}
function getEffectivePriority(task: Task): EscalatedPriority {
  const daysUntilDue = getDaysUntilDueDash(task.dueDate);
  const original = task.priority;
  let effective: Task['priority'] = original;
  if (!task.completed && task.dueDate) {
    if (daysUntilDue <= 1) effective = 'high';
    else if (daysUntilDue <= 4 && original === 'low') effective = 'medium';
  }
  return { effective, original, wasEscalated: effective !== original, daysUntilDue };
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

const { width: SCREEN_W } = Dimensions.get('window');
const PADDING = 20;
const CARD_GAP = 10;
const STAT_W = (SCREEN_W - PADDING * 2 - CARD_GAP) / 2;

// Donut chart component
const PIE_SIZE = 100;
function DonutChart({ data, colors: themeColors }: {
  data: { label: string; value: number; color: string }[];
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const c = PIE_SIZE / 2;
  const r = c - 4;
  const ir = r * 0.6;

  if (total === 0) {
    return (
      <View style={{ alignItems: 'center' }}>
        <Svg width={PIE_SIZE} height={PIE_SIZE} viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}>
          <Circle cx={c} cy={c} r={r} fill={themeColors.surfaceVariant} />
          <Circle cx={c} cy={c} r={ir} fill={themeColors.card} />
          <SvgText x={c} y={c + 4} textAnchor="middle" fontSize="11" fill={themeColors.textMuted}>No data</SvgText>
        </Svg>
      </View>
    );
  }

  let angle = -90;
  const segments = data.filter(d => d.value > 0).map(d => {
    const sweep = (d.value / total) * 360;
    const startAngle = angle;
    angle += sweep;
    if (sweep >= 359.99) return { ...d, full: true };
    const sr = (startAngle * Math.PI) / 180;
    const er = ((startAngle + sweep) * Math.PI) / 180;
    const largeArc = sweep > 180 ? 1 : 0;
    const path = `M${c} ${c}L${c + r * Math.cos(sr)} ${c + r * Math.sin(sr)}A${r} ${r} 0 ${largeArc} 1 ${c + r * Math.cos(er)} ${c + r * Math.sin(er)}Z`;
    return { ...d, full: false, path };
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={PIE_SIZE} height={PIE_SIZE} viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}>
        {segments.map((s, i) =>
          s.full
            ? <Circle key={i} cx={c} cy={c} r={r} fill={s.color} />
            : <Path key={i} d={(s as any).path} fill={s.color} />
        )}
        <Circle cx={c} cy={c} r={ir} fill={themeColors.card} />
        <SvgText x={c} y={c - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill={themeColors.text}>{total}</SvgText>
        <SvgText x={c} y={c + 14} textAnchor="middle" fontSize="8" fontWeight="700" fill={themeColors.textMuted} letterSpacing={0.8}>TOTAL</SvgText>
      </Svg>
    </View>
  );
}

function ChartLegend({ data }: { data: { label: string; value: number; color: string }[] }) {
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color }} />
          <Text style={{ fontSize: 11, color: '#888', flex: 1 }}>{d.label}</Text>
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#555' }}>{d.value}</Text>
        </View>
      ))}
    </View>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { colors, accent } = useAppTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedStat, setExpandedStat] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [t, r] = await Promise.all([
      getTasks(user.id),
      getReminders(user.id),
    ]);
    setTasks(t);
    setReminders(r);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleToggle = async (id: number) => {
    const updated = await toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  };

  const toggleStatExpand = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedStat(prev => prev === key ? null : key);
  };

  const todayStr = localDateStr();
  const weekStr = daysFromNow(7);

  const overdue = tasks.filter(t => !t.completed && t.dueDate < todayStr);
  const dueToday = tasks.filter(t => !t.completed && t.dueDate === todayStr);
  const upcoming = tasks.filter(t => !t.completed && t.dueDate > todayStr && t.dueDate <= weekStr);
  const remToday = reminders.filter(r => r.date === todayStr);
  const remUpcoming = reminders.filter(r => r.date > todayStr && r.date <= weekStr);
  const completedTasks = tasks.filter(t => t.completed);
  const completed = completedTasks.length;
  const active = tasks.filter(t => !t.completed).length;

  const priorityData = [
    { label: 'High', value: tasks.filter(t => !t.completed && t.priority === 'high').length, color: '#D57272' },
    { label: 'Medium', value: tasks.filter(t => !t.completed && t.priority === 'medium').length, color: '#EDC78F' },
    { label: 'Low', value: tasks.filter(t => !t.completed && t.priority === 'low').length, color: '#8BD4A0' },
  ];

  const statusData = [
    { label: 'Overdue', value: overdue.length, color: '#DC2626' },
    { label: 'On Track', value: tasks.filter(t => !t.completed && t.dueDate >= todayStr).length, color: '#006A4E' },
    { label: 'Completed', value: completed, color: '#0AA56F' },
  ];

  const statItems = [
    { key: 'overdue', label: 'Overdue', count: overdue.length, items: overdue },
    { key: 'today', label: 'Due Today', count: dueToday.length + remToday.length, items: [...dueToday] },
    { key: 'week', label: 'This Week', count: upcoming.length, items: upcoming },
    { key: 'completed', label: 'Completed', count: completed, items: completedTasks },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] || '';

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }, styles.center]}>
        <Text style={{ color: colors.textMuted, fontSize: 15 }}>Loading your planner...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { color: colors.text }]}>{greeting}, {firstName}</Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/settings')}
          style={[styles.settingsBtn, { backgroundColor: colors.surfaceVariant }]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: accent.primary }]}
          onPress={() => router.push('/(tabs)/tasks')}
        >
          <Ionicons name="add" size={16} color="#FFF" />
          <Text style={styles.quickBtnText}>Quick Task</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: colors.surfaceVariant }]}
          onPress={() => router.push('/(tabs)/reminders')}
        >
          <Ionicons name="notifications-outline" size={16} color={colors.text} />
          <Text style={[styles.quickBtnText, { color: colors.text }]}>Quick Reminder</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Grid — 2x2 with expandable drawers */}
      <View style={styles.statsGrid}>
        {statItems.map((s) => (
          <TouchableOpacity
            key={s.key}
            activeOpacity={0.8}
            onPress={() => toggleStatExpand(s.key)}
            style={[
              styles.statCard,
              {
                width: STAT_W,
                backgroundColor: s.key === 'overdue' ? colors.priorityHigh
                  : s.key === 'today' ? colors.priorityMedium
                  : s.key === 'week' ? colors.priorityLow
                  : accent.surface,
                borderWidth: expandedStat === s.key ? 2 : 0,
                borderColor: s.key === 'overdue' ? colors.priorityHighText
                  : s.key === 'today' ? colors.priorityMediumText
                  : s.key === 'week' ? colors.priorityLowText
                  : accent.primary,
              },
            ]}
          >
            <Text style={[styles.statNum, {
              color: s.key === 'overdue' ? colors.priorityHighText
                : s.key === 'today' ? colors.priorityMediumText
                : s.key === 'week' ? colors.priorityLowText
                : accent.primary,
            }]}>{s.count}</Text>
            <Text style={[styles.statLabel, {
              color: s.key === 'overdue' ? colors.priorityHighText
                : s.key === 'today' ? colors.priorityMediumText
                : s.key === 'week' ? colors.priorityLowText
                : accent.primary,
            }]}>{s.label}</Text>
            <Ionicons
              name={expandedStat === s.key ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={s.key === 'overdue' ? colors.priorityHighText
                : s.key === 'today' ? colors.priorityMediumText
                : s.key === 'week' ? colors.priorityLowText
                : accent.primary}
              style={{ marginTop: 2 }}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Expanded stat drawer */}
      {expandedStat && (() => {
        const stat = statItems.find(s => s.key === expandedStat);
        if (!stat) return null;
        return (
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {stat.label} ({stat.count})
              </Text>
              <TouchableOpacity onPress={() => toggleStatExpand(expandedStat)}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {stat.items.length === 0 ? (
              <View style={styles.emptyRow}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {expandedStat === 'overdue' ? "No overdue items — you're on track!"
                    : expandedStat === 'today' ? 'Nothing due today'
                    : expandedStat === 'week' ? 'Nothing scheduled this week'
                    : 'No completed tasks yet'}
                </Text>
              </View>
            ) : (
              stat.items.slice(0, 5).map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  colors={colors}
                  accent={accent}
                  showDate
                  isLast={i === Math.min(stat.items.length, 5) - 1}
                />
              ))
            )}
          </View>
        );
      })()}

      {/* Upcoming Timeline */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="calendar-outline" size={16} color={accent.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming — 7 Days</Text>
          </View>
          <Link href="/(tabs)/calendar" asChild>
            <TouchableOpacity><Text style={[styles.sectionLink, { color: accent.primary }]}>Calendar</Text></TouchableOpacity>
          </Link>
        </View>
        {(() => {
          const timeline: Array<(Task | Reminder) & { _type: string }> = [
            ...upcoming.map(t => ({ ...t, _type: 'task' })),
            ...remUpcoming.map(r => ({ ...r, _type: 'reminder' })),
          ].sort((a, b) => {
            const aDate = (a as any).dueDate || (a as any).date;
            const bDate = (b as any).dueDate || (b as any).date;
            return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
          });

          if (timeline.length === 0) {
            return (
              <View style={styles.emptyRow}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>All clear this week</Text>
              </View>
            );
          }

          return timeline.slice(0, 6).map((item, i) =>
            item._type === 'task' ? (
              <TaskRow
                key={`t-${item.id}`}
                task={item as Task}
                onToggle={handleToggle}
                colors={colors}
                accent={accent}
                showDate
                isLast={i === Math.min(timeline.length, 6) - 1}
              />
            ) : (
              <ReminderRow
                key={`r-${item.id}`}
                reminder={item as Reminder}
                colors={colors}
                accent={accent}
                showDate
                isLast={i === Math.min(timeline.length, 6) - 1}
              />
            )
          );
        })()}
      </View>

      {/* Analytics Charts */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="pie-chart-outline" size={16} color={accent.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Analytics</Text>
          </View>
        </View>
        <View style={styles.chartsRow}>
          <View style={styles.chartBlock}>
            <Text style={[styles.chartTitle, { color: colors.textSecondary }]}>By Priority</Text>
            <DonutChart data={priorityData} colors={colors} />
            <ChartLegend data={priorityData} />
          </View>
          <View style={[styles.chartDivider, { backgroundColor: colors.borderLight }]} />
          <View style={styles.chartBlock}>
            <Text style={[styles.chartTitle, { color: colors.textSecondary }]}>By Status</Text>
            <DonutChart data={statusData} colors={colors} />
            <ChartLegend data={statusData} />
          </View>
        </View>
      </View>

      {/* Quick Stats Footer */}
      <View style={[styles.quickStats, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.quickStatItem}>
          <Text style={[styles.quickStatNum, { color: accent.primary }]}>{active}</Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>Active</Text>
        </View>
        <View style={[styles.quickStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.quickStatItem}>
          <Text style={[styles.quickStatNum, { color: colors.success }]}>{completed}</Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>Done</Text>
        </View>
        <View style={[styles.quickStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.quickStatItem}>
          <Text style={[styles.quickStatNum, { color: colors.warning }]}>{reminders.length}</Text>
          <Text style={[styles.quickStatLabel, { color: colors.textMuted }]}>Reminders</Text>
        </View>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

function TaskRow({ task, onToggle, colors, accent, showDate = false, isLast = false }: {
  task: Task;
  onToggle: (id: number) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  showDate?: boolean;
  isLast?: boolean;
}) {
  const isOverdue = !task.completed && task.dueDate < localDateStr();
  const ep = getEffectivePriority(task);
  const priorityColors = {
    high: { bg: colors.priorityHigh, text: colors.priorityHighText },
    medium: { bg: colors.priorityMedium, text: colors.priorityMediumText },
    low: { bg: colors.priorityLow, text: colors.priorityLowText },
  };
  const pc = priorityColors[ep.effective] || priorityColors.medium;

  return (
    <TouchableOpacity
      style={[rowStyles.row, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}
      onPress={() => onToggle(task.id)}
      activeOpacity={0.7}
    >
      <View style={[rowStyles.check, {
        borderColor: task.completed ? accent.primary : colors.textMuted,
        backgroundColor: task.completed ? accent.primary : 'transparent',
      }]}>
        {task.completed && <Ionicons name="checkmark" size={12} color="#FFF" />}
      </View>
      <View style={rowStyles.body}>
        <Text style={[rowStyles.title, {
          color: task.completed ? colors.textMuted : colors.text,
          textDecorationLine: task.completed ? 'line-through' : 'none',
        }]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={rowStyles.meta}>
          {showDate && (
            <Text style={[rowStyles.metaText, { color: isOverdue ? colors.error : colors.textMuted }]}>
              {formatDate(task.dueDate)}
            </Text>
          )}
          {task.category && !showDate && (
            <Text style={[rowStyles.metaText, { color: colors.textMuted }]}>{task.category}</Text>
          )}
          <View style={[rowStyles.badge, { backgroundColor: pc.bg }]}>
            <Text style={[rowStyles.badgeText, { color: pc.text }]}>
              {ep.effective}{ep.wasEscalated && !task.completed ? ' ↑' : ''}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ReminderRow({ reminder, colors, accent, showDate = false, isLast = false }: {
  reminder: Reminder;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  showDate?: boolean;
  isLast?: boolean;
}) {
  return (
    <View style={[rowStyles.row, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
      <View style={[rowStyles.bellWrap, { backgroundColor: accent.surface }]}>
        <Ionicons name="notifications" size={14} color={accent.primary} />
      </View>
      <View style={rowStyles.body}>
        <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>{reminder.title}</Text>
        <View style={rowStyles.meta}>
          {showDate && <Text style={[rowStyles.metaText, { color: colors.textMuted }]}>{formatDate(reminder.date)}</Text>}
          {reminder.time ? <Text style={[rowStyles.metaText, { color: colors.textMuted }]}>{formatTime(reminder.time)}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, gap: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bellWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: PADDING, paddingTop: Platform.OS === 'ios' ? 8 : 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  greeting: { fontSize: 26, fontWeight: '700' },
  date: { fontSize: 14, marginTop: 2 },
  settingsBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  quickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  quickBtnText: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP, marginBottom: 12 },
  statCard: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  sectionCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  sectionLink: { fontSize: 13, fontWeight: '500' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  emptyText: { fontSize: 14 },
  chartsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  chartBlock: { flex: 1, alignItems: 'center' },
  chartTitle: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  chartDivider: { width: 1, height: '100%' as any, marginHorizontal: 8 },
  quickStats: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 14 },
  quickStatItem: { flex: 1, alignItems: 'center' },
  quickStatNum: { fontSize: 20, fontWeight: '700' },
  quickStatLabel: { fontSize: 11, marginTop: 2 },
  quickStatDivider: { width: 1, marginVertical: 4 },
});
