import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Modal, Platform, RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getTasks, createTask, updateTask, deleteTask, toggleTask } from '@/api/tasks';
import { getCategories } from '@/api/categories';
import { Task, Category } from '@/types';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const todayStr = localDateStr();
  if (dateStr === todayStr) return 'Today';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

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
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteTask(id);
        setTasks(prev => prev.filter(t => t.id !== id));
      }},
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

  const todayStr = localDateStr();
  let filtered = [...tasks];
  if (filter === 'active') filtered = filtered.filter(t => !t.completed);
  else if (filter === 'completed') filtered = filtered.filter(t => t.completed);
  filtered.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const activeCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const overdueCount = tasks.filter(t => !t.completed && t.dueDate < todayStr).length;

  const s = makeStyles(colors, accent);

  return (
    <View style={s.container}>
      {/* Header bar */}
      <View style={s.headerBar}>
        <Text style={s.subtitle}>
          {activeCount} active · {completedCount} completed
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

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
      >
        {loading ? (
          <Text style={s.emptyText}>Loading tasks...</Text>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="checkbox-outline" size={48} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No tasks found</Text>
            <Text style={s.emptyText}>Adjust filters or add a new task.</Text>
          </View>
        ) : (
          filtered.map(task => {
            const isOverdue = !task.completed && task.dueDate < todayStr;
            const pc = {
              high: { bg: colors.priorityHigh, text: colors.priorityHighText },
              medium: { bg: colors.priorityMedium, text: colors.priorityMediumText },
              low: { bg: colors.priorityLow, text: colors.priorityLowText },
            }[task.priority] || { bg: colors.priorityMedium, text: colors.priorityMediumText };

            return (
              <TouchableOpacity
                key={task.id}
                style={[s.card, {
                  backgroundColor: task.completed ? colors.surfaceVariant : pc.bg,
                  borderColor: isOverdue ? colors.error : colors.border,
                  borderLeftWidth: isOverdue ? 3 : 0,
                  borderLeftColor: colors.error,
                }]}
                onPress={() => handleToggle(task.id)}
                onLongPress={() => { setEditingTask(task); setModalVisible(true); }}
                activeOpacity={0.7}
              >
                <View style={s.cardTop}>
                  <View style={[s.check, {
                    borderColor: task.completed ? accent.primary : pc.text,
                    backgroundColor: task.completed ? accent.primary : 'transparent',
                  }]}>
                    {task.completed && <Ionicons name="checkmark" size={12} color="#FFF" />}
                  </View>
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, {
                      color: task.completed ? colors.textMuted : pc.text,
                      textDecorationLine: task.completed ? 'line-through' : 'none',
                    }]} numberOfLines={2}>{task.title}</Text>
                    <View style={s.cardMeta}>
                      {task.dueDate && (
                        <Text style={[s.cardMetaText, { color: isOverdue ? colors.error : (task.completed ? colors.textMuted : pc.text) }]}>
                          {isOverdue ? '⚠ ' : ''}{formatDate(task.dueDate)}
                          {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}
                        </Text>
                      )}
                      {task.category && <Text style={[s.cardMetaText, { color: task.completed ? colors.textMuted : pc.text }]}>{task.category}</Text>}
                    </View>
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity onPress={() => { setEditingTask(task); setModalVisible(true); }}>
                      <Ionicons name="pencil" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(task.id)}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
                {task.notes ? <Text style={[s.cardNotes, { color: task.completed ? colors.textMuted : pc.text }]} numberOfLines={2}>{task.notes}</Text> : null}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

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
    </View>
  );
}

function TaskModal({ visible, task, categories, colors, accent, defaultPriority, defaultCategory, onSave, onClose }: {
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
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [category, setCategory] = useState('Homework');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible) {
      setTitle(task?.title || '');
      setDueDate(task?.dueDate || localDateStr());
      setPriority(task?.priority || defaultPriority as Task['priority']);
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
            placeholder="Additional details..."
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </ScrollView>
      </View>
    </Modal>
  );
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
    card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
    cardMeta: { flexDirection: 'row', gap: 8 },
    cardMetaText: { fontSize: 12 },
    cardActions: { flexDirection: 'row', gap: 12, marginTop: 2 },
    cardNotes: { fontSize: 13, marginTop: 8, opacity: 0.8 },
    empty: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 12 },
    emptyText: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  });
}
