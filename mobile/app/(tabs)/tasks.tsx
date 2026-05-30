import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Modal, RefreshControl, Alert, LayoutAnimation,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getTasks, createTask, updateTask, deleteTask, toggleTask, batchUpdateTasks } from '@/api/tasks';
import { getCategories } from '@/api/categories';
import { Task, Category } from '@/types';

// ─── priority escalation (inlined so Metro always picks up changes) ──────────

type EscalatedPriority = {
  effective: Task['priority'];
  original: Task['priority'];
  wasEscalated: boolean;
  daysUntilDue: number;
};

type OverloadedDay = { date: string; tasks: Task[] };
type RescheduleSuggestion = { task: Task; from: string; to: string };

function getDaysUntilDue(dueDateStr: string): number {
  if (!dueDateStr) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

/** Computes effective display priority based on deadline proximity. */
function getEffectivePriority(task: Task): EscalatedPriority {
  const daysUntilDue = getDaysUntilDue(task.dueDate);
  const original = task.priority;
  let effective: Task['priority'] = original;
  if (!task.completed && task.dueDate) {
    if (daysUntilDue <= 1) {
      effective = 'high';                          // overdue / today / tomorrow → HIGH
    } else if (daysUntilDue <= 3) {
      if (original === 'low') effective = 'medium'; // 2-3 days: LOW → MEDIUM
    } else if (daysUntilDue <= 4) {
      if (original === 'low') effective = 'medium'; // 4 days: mild escalation
    }
  }
  return { effective, original, wasEscalated: effective !== original, daysUntilDue };
}

/** Returns FUTURE days (> today) with >= threshold incomplete tasks (default 3).
 *  Today and overdue dates are excluded — you can't pull those any earlier. */
function detectOverloadedDays(tasks: Task[], threshold = 3): OverloadedDay[] {
  const todayStr = localDateStr();
  const active = tasks.filter(t => !t.completed && t.dueDate && t.dueDate > todayStr);
  const byDate: Record<string, Task[]> = {};
  for (const t of active) {
    if (!byDate[t.dueDate]) byDate[t.dueDate] = [];
    byDate[t.dueDate].push(t);
  }
  return Object.entries(byDate)
    .filter(([, ts]) => ts.length >= threshold)
    .map(([date, ts]) => ({ date, tasks: ts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const PRIO_ORDER: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

/**
 * For each overloaded future day, suggests PULLING lower-priority tasks
 * FORWARD to earlier available dates (between today+1 and the overloaded day-1).
 * Never pushes tasks to a later date.
 *
 * Strategy: keep the `keepPerDay` highest-priority tasks on the original date;
 * suggest the rest be moved to the earliest available slot BEFORE that date.
 */
function suggestReschedule(
  overloadedDays: OverloadedDay[],
  allTasks: Task[],
  keepPerDay = 2,
): RescheduleSuggestion[] {
  const todayStr = localDateStr();

  // Mutable count map so we can reserve slots as we assign them
  const countByDate: Record<string, number> = {};
  for (const t of allTasks.filter(t => !t.completed && t.dueDate)) {
    countByDate[t.dueDate] = (countByDate[t.dueDate] || 0) + 1;
  }

  const suggestions: RescheduleSuggestion[] = [];

  for (const day of overloadedDays) {
    // Sort: highest stored priority first, then oldest creation date first
    const sorted = [...day.tasks].sort((a, b) =>
      PRIO_ORDER[a.priority] !== PRIO_ORDER[b.priority]
        ? PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Keep top keepPerDay tasks; suggest pulling the rest EARLIER
    for (const task of sorted.slice(keepPerDay)) {
      const overloadedDate = new Date(day.date + 'T00:00:00');
      const daysAway = getDaysUntilDue(day.date);
      let targetStr: string | null = null;

      // Search BACKWARDS from (overloaded day - 1) toward (today + 1)
      for (let offset = 1; offset < daysAway; offset++) {
        const candidate = new Date(overloadedDate);
        candidate.setDate(candidate.getDate() - offset);
        const candStr = localDateStr(candidate);
        if (candStr <= todayStr) break; // don't go to today or past
        const existing = countByDate[candStr] || 0;
        if (existing < keepPerDay) {
          targetStr = candStr;
          countByDate[candStr] = existing + 1;
          break;
        }
      }

      if (targetStr) suggestions.push({ task, from: day.date, to: targetStr });
    }
  }

  return suggestions;
}

/** Friendly date label relative to today. */
function friendlyDate(dateStr: string): string {
  const days = getDaysUntilDue(dateStr);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  if (dateStr === localDateStr()) return 'Today';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

// ─── main screen ────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { colors, accent } = useAppTheme();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [rescheduleVisible, setRescheduleVisible] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [t, c] = await Promise.all([getTasks(user.id), getCategories(user.id)]);
    setTasks(t);
    setCategories(c);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleToggle = async (id: number) => {
    const updated = await toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Task', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteTask(id);
          setTasks(prev => prev.filter(t => t.id !== id));
        },
      },
    ]);
  };

  const handleSave = async (form: Partial<Task>) => {
    if (editingTask) {
      const updated = await updateTask(editingTask.id, form);
      setTasks(prev => prev.map(t => t.id === editingTask.id ? updated : t));
    } else {
      const created = await createTask({ ...form, userId: user!.id, title: form.title || '' });
      setTasks(prev => [...prev, created]);
    }
    setModalVisible(false);
    setEditingTask(null);
  };

  const handleApplyReschedule = async (accepted: RescheduleSuggestion[]) => {
    if (accepted.length === 0) return;
    const updates = accepted.map(s => ({ id: s.task.id, changes: { dueDate: s.to } }));
    await batchUpdateTasks(updates);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTasks(prev =>
      prev.map(t => {
        const hit = accepted.find(s => s.task.id === t.id);
        return hit ? { ...t, dueDate: hit.to } : t;
      }),
    );
    setRescheduleVisible(false);
  };

  const todayStr = localDateStr();
  let filtered = [...tasks];
  if (filter === 'active') filtered = filtered.filter(t => !t.completed);
  else if (filter === 'completed') filtered = filtered.filter(t => t.completed);
  filtered.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const activeCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const overdueCount = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length;

  // Overload detection – only show banner when viewing active tasks
  const overloadedDays = filter !== 'completed' ? detectOverloadedDays(tasks) : [];
  const rescheduleSuggestions = overloadedDays.length > 0
    ? suggestReschedule(overloadedDays, tasks)
    : [];

  const s = makeStyles(colors, accent);

  // Priority color palette
  const priorityColors = {
    high: { bg: colors.priorityHigh, text: colors.priorityHighText },
    medium: { bg: colors.priorityMedium, text: colors.priorityMediumText },
    low: { bg: colors.priorityLow, text: colors.priorityLowText },
  };

  return (
    <View style={s.container}>
      {/* Header bar */}
      <View style={s.headerBar}>
        <Text style={s.subtitle}>
          {activeCount} active · {completedCount} done
          {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
        </Text>
        <TouchableOpacity
          style={[s.addBtn, { backgroundColor: accent.primary }]}
          onPress={() => { setEditingTask(null); setModalVisible(true); }}
        >
          <Ionicons name="add" size={20} color="#FFF" />
          <Text style={s.addBtnText}>Add Task</Text>
        </TouchableOpacity>
      </View>

      {/* Filter pills */}
      <View style={s.filterRow}>
        {(['active', 'completed', 'all'] as const).map(f => (
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

      {/* Overload warning banner */}
      {overloadedDays.length > 0 && (
        <TouchableOpacity
          style={[s.overloadBanner, { backgroundColor: '#FFF3CD', borderColor: '#FBBF24' }]}
          onPress={() => setRescheduleVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="warning-outline" size={18} color="#B45309" />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[s.overloadTitle, { color: '#92400E' }]}>
              {overloadedDays.length === 1
                ? `${overloadedDays[0].tasks.length} tasks on ${friendlyDate(overloadedDays[0].date)}`
                : `${overloadedDays.length} overloaded days detected`}
            </Text>
            <Text style={[s.overloadSub, { color: '#B45309' }]}>
              Pull tasks to earlier free days · {rescheduleSuggestions.length} suggestions
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#B45309" />
        </TouchableOpacity>
      )}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
      >
        {loading ? (
          <Text style={s.emptyText}>Loading tasks…</Text>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="checkbox-outline" size={48} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No tasks found</Text>
            <Text style={s.emptyText}>Adjust filters or add a new task.</Text>
          </View>
        ) : (
          filtered.map(task => {
            const ep = getEffectivePriority(task);
            const isOverdue = !task.completed && task.dueDate && task.dueDate < todayStr;
            const pc = task.completed
              ? { bg: colors.surfaceVariant, text: colors.textMuted }
              : priorityColors[ep.effective] ?? priorityColors.medium;

            return (
              <TouchableOpacity
                key={task.id}
                style={[s.card, {
                  backgroundColor: pc.bg,
                  borderColor: isOverdue ? colors.error : colors.border,
                  borderLeftWidth: isOverdue ? 4 : 1,
                  borderLeftColor: isOverdue ? colors.error : colors.border,
                }]}
                onPress={() => handleToggle(task.id)}
                onLongPress={() => { setEditingTask(task); setModalVisible(true); }}
                activeOpacity={0.75}
              >
                <View style={s.cardTop}>
                  {/* Checkbox */}
                  <View style={[s.check, {
                    borderColor: task.completed ? accent.primary : pc.text,
                    backgroundColor: task.completed ? accent.primary : 'transparent',
                  }]}>
                    {task.completed && <Ionicons name="checkmark" size={12} color="#FFF" />}
                  </View>

                  {/* Body */}
                  <View style={s.cardBody}>
                    <View style={s.titleRow}>
                      <Text style={[s.cardTitle, {
                        color: pc.text,
                        textDecorationLine: task.completed ? 'line-through' : 'none',
                        flex: 1,
                      }]} numberOfLines={2}>
                        {task.title}
                      </Text>
                      {/* Priority badge row */}
                      <View style={s.badgeRow}>
                        {ep.wasEscalated && !task.completed && (
                          <View style={[s.escalateBadge, { backgroundColor: '#DC2626' }]}>
                            <Ionicons name="arrow-up" size={9} color="#FFF" />
                            <Text style={s.escalateBadgeText}>
                              {ep.daysUntilDue <= 0 ? 'OVERDUE' : ep.daysUntilDue === 1 ? 'TMR' : `${ep.daysUntilDue}D`}
                            </Text>
                          </View>
                        )}
                        <View style={[s.priorityBadge, {
                          backgroundColor: task.completed
                            ? colors.surfaceVariant
                            : priorityColors[ep.effective]?.bg ?? pc.bg,
                          borderColor: task.completed ? colors.border : pc.text + '44',
                        }]}>
                          <Text style={[s.priorityBadgeText, { color: pc.text }]}>
                            {ep.effective.charAt(0).toUpperCase() + ep.effective.slice(1)}
                            {ep.wasEscalated && !task.completed ? ` ↑` : ''}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={s.cardMeta}>
                      {task.dueDate && (
                        <Text style={[s.cardMetaText, {
                          color: isOverdue ? colors.error : pc.text,
                          fontWeight: isOverdue ? '600' : '400',
                        }]}>
                          {isOverdue ? '⚠ ' : ''}{formatDate(task.dueDate)}
                          {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}
                        </Text>
                      )}
                      {task.category && (
                        <Text style={[s.cardMetaText, { color: task.completed ? colors.textMuted : pc.text }]}>
                          {task.category}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={s.cardActions}>
                    <TouchableOpacity onPress={() => { setEditingTask(task); setModalVisible(true); }}>
                      <Ionicons name="pencil" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(task.id)}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>

                {task.notes ? (
                  <Text style={[s.cardNotes, { color: task.completed ? colors.textMuted : pc.text }]} numberOfLines={2}>
                    {task.notes}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Task create/edit modal */}
      <TaskModal
        visible={modalVisible}
        task={editingTask}
        categories={categories}
        colors={colors}
        accent={accent}
        defaultPriority={settings.defaultPriority}
        defaultCategory={settings.defaultCategory}
        onSave={handleSave}
        onClose={() => { setModalVisible(false); setEditingTask(null); }}
      />

      {/* Reschedule modal */}
      <RescheduleModal
        visible={rescheduleVisible}
        overloadedDays={overloadedDays}
        suggestions={rescheduleSuggestions}
        colors={colors}
        accent={accent}
        onApply={handleApplyReschedule}
        onClose={() => setRescheduleVisible(false)}
      />
    </View>
  );
}

// ─── Reschedule Modal ────────────────────────────────────────────────────────

function RescheduleModal({
  visible, overloadedDays, suggestions, colors, accent, onApply, onClose,
}: {
  visible: boolean;
  overloadedDays: OverloadedDay[];
  suggestions: RescheduleSuggestion[];
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  onApply: (accepted: RescheduleSuggestion[]) => void;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  // Pre-select all on open
  useEffect(() => {
    if (visible) setAccepted(new Set(suggestions.map(s => s.task.id)));
  }, [visible, suggestions]);

  const toggle = (id: number) => {
    setAccepted(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const accepted_list = suggestions.filter(s => accepted.has(s.task.id));
  const rs = rescheduleStyles(colors, accent);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={rs.container}>
        {/* Header */}
        <View style={rs.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[rs.headerBtn, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={rs.title}>Optimize Schedule</Text>
          <TouchableOpacity
            onPress={() => onApply(accepted_list)}
            disabled={accepted_list.length === 0}
          >
            <Text style={[rs.headerBtn, { color: accepted_list.length > 0 ? accent.primary : colors.textMuted, fontWeight: '600' }]}>
              Apply {accepted_list.length > 0 ? `(${accepted_list.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          {/* Summary */}
          <View style={[rs.infoBox, { backgroundColor: accent.light ?? '#E8F5E9' }]}>
            <Ionicons name="information-circle-outline" size={18} color={accent.primary} />
            <Text style={[rs.infoText, { color: accent.primary }]}>
              {overloadedDays.length === 1
                ? `${overloadedDays[0].tasks.length} tasks are due on ${friendlyDate(overloadedDays[0].date)}.`
                : `${overloadedDays.length} days have 3+ tasks due.`}
              {' '}High-priority tasks stay; lower-priority ones are pulled to earlier free days.
            </Text>
          </View>

          {/* Overloaded days summary */}
          {overloadedDays.map(day => (
            <View key={day.date} style={rs.dayBlock}>
              <View style={rs.dayHeader}>
                <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} />
                <Text style={[rs.dayLabel, { color: colors.text }]}>
                  {friendlyDate(day.date)} — {day.tasks.length} tasks
                </Text>
              </View>
              {day.tasks.map(t => {
                const ep = getEffectivePriority(t);
                return (
                  <Text key={t.id} style={[rs.dayTask, { color: colors.textSecondary }]}>
                    • {t.title}{ep.wasEscalated ? '  ↑ escalated' : ''}
                  </Text>
                );
              })}
            </View>
          ))}

          {/* Suggestions */}
          {suggestions.length > 0 ? (
            <>
              <Text style={[rs.sectionLabel, { color: colors.textSecondary }]}>
                SUGGESTED MOVES
              </Text>
              {suggestions.map(s => {
                const isOn = accepted.has(s.task.id);
                return (
                  <TouchableOpacity
                    key={s.task.id}
                    style={[rs.suggestionRow, {
                      backgroundColor: isOn ? (accent.light ?? '#E8F5E9') : colors.surfaceVariant,
                      borderColor: isOn ? accent.primary : colors.border,
                    }]}
                    onPress={() => toggle(s.task.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[rs.checkbox, {
                      backgroundColor: isOn ? accent.primary : 'transparent',
                      borderColor: isOn ? accent.primary : colors.border,
                    }]}>
                      {isOn && <Ionicons name="checkmark" size={12} color="#FFF" />}
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[rs.suggestionTitle, { color: colors.text }]} numberOfLines={1}>
                        {s.task.title}
                      </Text>
                      <View style={rs.moveRow}>
                        <Text style={[rs.moveDate, { color: colors.error }]}>{friendlyDate(s.from)}</Text>
                        <Ionicons name="arrow-forward" size={13} color={colors.textMuted} style={{ marginHorizontal: 6 }} />
                        <Text style={[rs.moveDate, { color: accent.primary }]}>{friendlyDate(s.to)}</Text>
                      </View>
                    </View>
                    <View style={[rs.priorityDot, {
                      backgroundColor:
                        s.task.priority === 'high' ? '#D57272'
                          : s.task.priority === 'medium' ? '#EDC78F' : '#8BD4A0',
                    }]} />
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <View style={rs.noSuggestions}>
              <Ionicons name="checkmark-circle-outline" size={40} color={accent.primary} />
              <Text style={[rs.noSuggestionsText, { color: colors.textSecondary }]}>
                No nearby dates available. Try adjusting due dates manually.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom action */}
        {suggestions.length > 0 && (
          <View style={[rs.bottomBar, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[rs.applyBtn, { backgroundColor: accepted_list.length > 0 ? accent.primary : colors.surfaceVariant }]}
              onPress={() => onApply(accepted_list)}
              disabled={accepted_list.length === 0}
            >
              <Ionicons name="shuffle-outline" size={18} color={accepted_list.length > 0 ? '#FFF' : colors.textMuted} />
              <Text style={[rs.applyBtnText, { color: accepted_list.length > 0 ? '#FFF' : colors.textMuted }]}>
                Move {accepted_list.length} Task{accepted_list.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Task create/edit modal ──────────────────────────────────────────────────

function TaskModal({
  visible, task, categories, colors, accent, defaultPriority, defaultCategory, onSave, onClose,
}: {
  visible: boolean;
  task: Task | null;
  categories: Category[];
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  defaultPriority: string;
  defaultCategory: string;
  onSave: (form: Partial<Task>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [category, setCategory] = useState('Homework');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible) {
      setTitle(task?.title || '');
      setDueDate(task?.dueDate || localDateStr());
      setPriority((task?.priority || defaultPriority) as Task['priority']);
      setCategory(task?.category || defaultCategory);
      setNotes(task?.notes || '');
    }
  }, [visible, task]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), dueDate, priority, category, notes });
  };

  const ms = modalStyles(colors, accent);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ms.container}>
        <View style={ms.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[ms.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={ms.headerTitle}>{task ? 'Edit Task' : 'New Task'}</Text>
          <TouchableOpacity onPress={handleSubmit}>
            <Text style={[ms.saveText, { color: accent.primary }]}>{task ? 'Save' : 'Add'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={ms.form} keyboardShouldPersistTaps="handled">
          <Text style={ms.label}>Title</Text>
          <TextInput
            style={ms.input}
            value={title}
            onChangeText={setTitle}
            placeholder="What needs to be done?"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />

          <Text style={ms.label}>Due Date</Text>
          <TextInput
            style={ms.input}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={ms.label}>Priority</Text>
          <View style={ms.segmentRow}>
            {(['high', 'medium', 'low'] as const).map(p => (
              <TouchableOpacity
                key={p}
                style={[ms.segment, priority === p && { backgroundColor: accent.primary }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[ms.segmentText, priority === p && { color: '#FFF' }]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={ms.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ms.chipScroll}>
            {categories.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[ms.chip, category === c.name && { backgroundColor: accent.primary, borderColor: accent.primary }]}
                onPress={() => setCategory(c.name)}
              >
                <Text style={[ms.chipText, category === c.name && { color: '#FFF' }]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={ms.label}>Notes</Text>
          <TextInput
            style={[ms.input, { height: 80, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Additional details…"
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
    subtitle: { fontSize: 13, color: colors.textSecondary },
    addBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 4 },
    addBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
    filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 },
    filterPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surfaceVariant },
    filterText: { fontSize: 13, fontWeight: '500', color: colors.text },
    // Overload banner
    overloadBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
    overloadTitle: { fontSize: 13, fontWeight: '600' },
    overloadSub: { fontSize: 12, marginTop: 1 },
    // List
    list: { paddingHorizontal: 20 },
    card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 },
    cardBody: { flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
    badgeRow: { flexDirection: 'row', gap: 4, alignItems: 'center', flexShrink: 0 },
    escalateBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, gap: 2 },
    escalateBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFF' },
    priorityBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
    priorityBadgeText: { fontSize: 10, fontWeight: '600' },
    cardMeta: { flexDirection: 'row', gap: 8 },
    cardMetaText: { fontSize: 12 },
    cardActions: { flexDirection: 'row', gap: 12, marginTop: 2, flexShrink: 0 },
    cardNotes: { fontSize: 13, marginTop: 8, opacity: 0.8 },
    empty: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 12 },
    emptyText: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  });
}

function rescheduleStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { fontSize: 17, fontWeight: '600', color: colors.text },
    headerBtn: { fontSize: 16 },
    infoBox: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, borderRadius: 10, marginBottom: 20, gap: 8 },
    infoText: { fontSize: 13, flex: 1, lineHeight: 18 },
    dayBlock: { backgroundColor: colors.surfaceVariant, borderRadius: 10, padding: 12, marginBottom: 12 },
    dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    dayLabel: { fontSize: 14, fontWeight: '600' },
    dayTask: { fontSize: 13, marginBottom: 2, marginLeft: 4 },
    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
    suggestionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1.5 },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    suggestionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
    moveRow: { flexDirection: 'row', alignItems: 'center' },
    moveDate: { fontSize: 12, fontWeight: '600' },
    priorityDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
    noSuggestions: { alignItems: 'center', paddingVertical: 40, gap: 12 },
    noSuggestionsText: { fontSize: 14, textAlign: 'center' },
    bottomBar: { padding: 20, borderTopWidth: 1 },
    applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 14, gap: 8 },
    applyBtnText: { fontSize: 16, fontWeight: '700' },
  });
}

function modalStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    cancelText: { fontSize: 16 },
    saveText: { fontSize: 16, fontWeight: '600' },
    form: { padding: 20 },
    label: { fontSize: 14, fontWeight: '500', color: colors.textSecondary, marginBottom: 6, marginTop: 16 },
    input: { backgroundColor: colors.surfaceVariant, borderRadius: 10, padding: 14, fontSize: 16, color: colors.text, borderWidth: 1, borderColor: colors.border },
    segmentRow: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: colors.surfaceVariant },
    segmentText: { fontSize: 14, fontWeight: '500', color: colors.text },
    chipScroll: { marginBottom: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, backgroundColor: colors.surfaceVariant },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.text },
  });
}
