import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Modal, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getTasks, toggleTask } from '@/api/tasks';
import { getReminders } from '@/api/reminders';
import { PlannerRecordId, Task, Reminder } from '@/types';
import { localDateStr } from '@/utils/schedule';
import {
  allDayItems, CALENDAR_VIEWS, CalendarView, dayHeaders, formatHour, formatTime,
  getNavTitle, getViewDates, HOURS, itemsInHour, minutesIntoDay, monthCells, stepCursor,
} from '@/utils/calendarView';

type CalItem = (Task & { _type: 'task' }) | (Reminder & { _type: 'reminder' });

const VIEW_ICONS: Record<CalendarView, keyof typeof Ionicons.glyphMap> = {
  day: 'today-outline',
  threeday: 'albums-outline',
  workweek: 'list-outline',
  week: 'calendar-outline',
  month: 'grid-outline',
};

const HOUR_HEIGHT = 52;
const TIME_GUTTER = 46;
const MIN_COL_WIDTH = 62;

export default function CalendarScreen() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { colors, accent } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<CalendarView>('month');
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
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
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleToggle = async (id: PlannerRecordId) => {
    const updated = await toggleTask(id);
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
  };

  const navigate = (direction: -1 | 1) => {
    const next = stepCursor({ selectedDate, year, month }, view, direction);
    setSelectedDate(next.selectedDate);
    setYear(next.year);
    setMonth(next.month);
  };

  const goToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
    setSelectedDate(todayStr);
  };

  const selectDay = (date: string) => {
    setSelectedDate(date);
    // Keep the month strip on the month the selection belongs to, so switching
    // back to the month view does not land somewhere else.
    const d = new Date(date + 'T00:00:00');
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalItem[]> = {};
    for (const t of tasks) {
      if (!t.dueDate) continue;
      (map[t.dueDate] ||= []).push({ ...t, _type: 'task' });
    }
    for (const r of reminders) {
      if (!r.date) continue;
      (map[r.date] ||= []).push({ ...r, _type: 'reminder' });
    }
    return map;
  }, [tasks, reminders]);

  const navTitle = getNavTitle(view, selectedDate, year, month, settings.weekStartsOn);
  const viewDates = getViewDates(selectedDate, view, settings.weekStartsOn);
  const s = makeStyles(colors, accent);

  return (
    <View style={s.container}>
      <View style={s.nav}>
        <TouchableOpacity onPress={goToday} style={[s.todayBtn, { borderColor: accent.primary }]}>
          <Text style={[s.todayBtnText, { color: accent.primary }]}>Today</Text>
        </TouchableOpacity>
        <View style={s.navCenter}>
          <TouchableOpacity onPress={() => navigate(-1)} style={s.navArrow} accessibilityLabel="Previous">
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.navTitle} numberOfLines={1}>{navTitle}</Text>
          <TouchableOpacity onPress={() => navigate(1)} style={s.navArrow} accessibilityLabel="Next">
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[s.viewBtn, { borderColor: colors.border }]}
          onPress={() => setViewPickerOpen(true)}
          accessibilityLabel={`Change view, currently ${view}`}
        >
          <Ionicons name={VIEW_ICONS[view]} size={16} color={colors.text} />
          <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {view === 'month' ? (
        <MonthView
          year={year}
          month={month}
          weekStartsOn={settings.weekStartsOn}
          itemsByDate={itemsByDate}
          selectedDate={selectedDate}
          todayStr={todayStr}
          onSelectDay={selectDay}
          onToggleTask={handleToggle}
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={colors}
          accent={accent}
        />
      ) : (
        <TimeGrid
          dates={viewDates}
          itemsByDate={itemsByDate}
          todayStr={todayStr}
          selectedDate={selectedDate}
          screenWidth={screenWidth}
          onSelectDay={date => { selectDay(date); setView('day'); }}
          onToggleTask={handleToggle}
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={colors}
          accent={accent}
        />
      )}

      <Modal visible={viewPickerOpen} transparent animationType="fade" onRequestClose={() => setViewPickerOpen(false)}>
        <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setViewPickerOpen(false)}>
          <View style={[s.picker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {CALENDAR_VIEWS.map(option => {
              const active = option.key === view;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={s.pickerRow}
                  onPress={() => { setView(option.key); setViewPickerOpen(false); }}
                >
                  <Ionicons
                    name={active ? 'checkmark' : VIEW_ICONS[option.key]}
                    size={16}
                    color={active ? accent.primary : colors.textMuted}
                  />
                  <Text style={[s.pickerText, active && { color: accent.primary, fontWeight: '700' }]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/* ── month ── */

interface ViewProps {
  itemsByDate: Record<string, CalItem[]>;
  selectedDate: string;
  todayStr: string;
  onToggleTask: (id: PlannerRecordId) => void;
  refreshing: boolean;
  onRefresh: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
}

function MonthView({
  year, month, weekStartsOn, itemsByDate, selectedDate, todayStr, onSelectDay,
  onToggleTask, refreshing, onRefresh, colors, accent,
}: ViewProps & {
  year: number;
  month: number;
  weekStartsOn: 'sunday' | 'monday';
  onSelectDay: (date: string) => void;
}) {
  const s = makeStyles(colors, accent);
  const cells = monthCells(year, month, weekStartsOn);
  const headers = dayHeaders(weekStartsOn);
  const selectedItems = itemsByDate[selectedDate] || [];

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
    >
      <View style={s.dayHeaderRow}>
        {headers.map((d, i) => (
          <View key={i} style={s.dayHeaderCell}>
            <Text style={s.dayHeaderText}>{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      <View style={s.grid}>
        {cells.map(cell => {
          const isToday = cell.date === todayStr;
          const isSelected = cell.date === selectedDate;
          const items = itemsByDate[cell.date] || [];
          const hasTask = items.some(i => i._type === 'task');
          const hasReminder = items.some(i => i._type === 'reminder');

          return (
            <TouchableOpacity
              key={cell.date}
              style={[s.cell, isSelected && { backgroundColor: accent.surface }]}
              onPress={() => onSelectDay(cell.date)}
              activeOpacity={0.6}
            >
              <View style={[s.dayNum, isToday && { backgroundColor: accent.primary }]}>
                <Text style={[
                  s.dayNumText,
                  // Spill-over days are dimmed rather than blank, so the first and
                  // last weeks still read as continuous.
                  { color: isToday ? '#FFF' : cell.inMonth ? colors.text : colors.textMuted },
                  isSelected && !isToday && { color: accent.primary, fontWeight: '700' },
                ]}>{cell.day}</Text>
              </View>
              <View style={s.dots}>
                {hasTask && <View style={[s.dot, { backgroundColor: accent.primary }]} />}
                {hasReminder && <View style={[s.dot, { backgroundColor: colors.warning }]} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[s.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={s.panelDate}>
          {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        {selectedItems.length === 0 ? (
          <Text style={s.panelEmpty}>Nothing scheduled for this day.</Text>
        ) : (
          selectedItems.map(item => (
            <DayPanelRow
              key={`${item._type[0]}-${item.id}`}
              item={item}
              onToggleTask={onToggleTask}
              colors={colors}
              accent={accent}
            />
          ))
        )}
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

function DayPanelRow({ item, onToggleTask, colors, accent }: {
  item: CalItem;
  onToggleTask: (id: PlannerRecordId) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
}) {
  const s = makeStyles(colors, accent);
  if (item._type === 'reminder') {
    return (
      <View style={[s.panelItem, { borderLeftColor: colors.warning }]}>
        <Ionicons name="notifications" size={16} color={colors.warning} />
        <View style={{ flex: 1 }}>
          <Text style={[s.panelItemTitle, { color: colors.text }]}>{item.title}</Text>
          {item.time ? <Text style={s.panelMeta}>{formatTime(item.time)}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[s.panelItem, { borderLeftColor: accent.primary }]}
      onPress={() => onToggleTask(item.id)}
    >
      <View style={[s.panelCheck, {
        borderColor: item.completed ? accent.primary : colors.textMuted,
        backgroundColor: item.completed ? accent.primary : 'transparent',
      }]}>
        {item.completed && <Ionicons name="checkmark" size={10} color="#FFF" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.panelItemTitle, {
          color: item.completed ? colors.textMuted : colors.text,
          textDecorationLine: item.completed ? 'line-through' : 'none',
        }]}>{item.title}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {item.dueTime ? <Text style={s.panelMeta}>{formatTime(item.dueTime)}</Text> : null}
          {item.category ? <Text style={s.panelMeta}>{item.category}</Text> : null}
          <Text style={[s.panelBadge, {
            color: item.priority === 'high' ? colors.error
              : item.priority === 'low' ? colors.success : colors.warning,
          }]}>{item.priority}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ── day / three day / work week / week ── */

function TimeGrid({
  dates, itemsByDate, todayStr, selectedDate, screenWidth, onSelectDay,
  onToggleTask, refreshing, onRefresh, colors, accent,
}: ViewProps & {
  dates: string[];
  screenWidth: number;
  onSelectDay: (date: string) => void;
}) {
  const s = makeStyles(colors, accent);
  const scrollRef = useRef<ScrollView>(null);
  const [nowMinutes, setNowMinutes] = useState(() => minutesIntoDay(new Date()));

  // Open on the current hour rather than at midnight, which is almost never
  // where the day's work is.
  useEffect(() => {
    const target = Math.max(0, (new Date().getHours() - 1) * HOUR_HEIGHT);
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, [dates[0], dates.length]);

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(minutesIntoDay(new Date())), 60000);
    return () => clearInterval(id);
  }, []);

  // Columns get an even share of the width, but never so narrow that a title is
  // unreadable — past that the grid scrolls sideways instead.
  const colWidth = Math.max(MIN_COL_WIDTH, (screenWidth - TIME_GUTTER) / dates.length);
  const totalWidth = TIME_GUTTER + colWidth * dates.length;
  const todayInView = dates.includes(todayStr);
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ height: '100%' }}>
      <View style={{ width: totalWidth, flex: 1 }}>
        {/* Headers and the all-day row sit outside the scroller, as on web:
            once the grid scrolls to the current hour there would be nothing
            left to say which column is which day. */}
        <View>
            <View style={s.tgHead}>
              <View style={{ width: TIME_GUTTER }} />
              {dates.map(date => {
                const d = new Date(date + 'T00:00:00');
                const isToday = date === todayStr;
                // Selected-but-not-today tints the header, so the text has to
                // move to the accent colour — plain text over that tint is
                // near-invisible in the dark theme.
                const onTint = date === selectedDate && !isToday;
                return (
                  <TouchableOpacity
                    key={date}
                    style={[
                      s.tgColHead,
                      { width: colWidth },
                      date === selectedDate && { backgroundColor: accent.surface },
                    ]}
                    onPress={() => onSelectDay(date)}
                    accessibilityLabel={`View ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  >
                    <Text style={[s.tgDow, onTint && { color: accent.primary }]}>
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </Text>
                    <View style={[s.tgDayNum, isToday && { backgroundColor: accent.primary }]}>
                      <Text style={[s.tgDayNumText, {
                        color: isToday ? '#FFF' : onTint ? accent.primary : colors.text,
                      }]}>
                        {d.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.tgAllDay}>
              <Text style={[s.tgTime, { width: TIME_GUTTER }]}>All day</Text>
              {dates.map(date => (
                <View key={date} style={[s.tgAllDayCell, { width: colWidth }]}>
                  {allDayItems(itemsByDate[date] || []).map(item => (
                    <Chip key={`${item._type[0]}-${item.id}`} item={item} onToggleTask={onToggleTask} colors={colors} accent={accent} />
                  ))}
                </View>
              ))}
            </View>
        </View>

        <ScrollView
          ref={scrollRef}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
        >
          <View>
            {HOURS.map(hour => (
              <View key={hour} style={[s.tgRow, { height: HOUR_HEIGHT }]}>
                <Text style={[s.tgTime, { width: TIME_GUTTER }]}>
                  {hour > 0 ? formatHour(hour) : ''}
                </Text>
                {dates.map(date => (
                  <View
                    key={date}
                    style={[
                      s.tgCell,
                      { width: colWidth },
                      date === todayStr && { backgroundColor: accent.surface },
                    ]}
                  >
                    {itemsInHour(itemsByDate[date] || [], hour).map(item => (
                      <Chip key={`${item._type[0]}-${item.id}`} item={item} onToggleTask={onToggleTask} colors={colors} accent={accent} />
                    ))}
                  </View>
                ))}
              </View>
            ))}

            {todayInView && (
              <View style={[s.tgNow, { top: nowTop, left: TIME_GUTTER }]} pointerEvents="none">
                <View style={s.tgNowDot} />
                <View style={s.tgNowLine} />
              </View>
            )}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function Chip({ item, onToggleTask, colors, accent }: {
  item: CalItem;
  onToggleTask: (id: PlannerRecordId) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
}) {
  const s = makeStyles(colors, accent);
  const isTask = item._type === 'task';
  const done = isTask && item.completed;
  return (
    <TouchableOpacity
      style={[s.tgChip, { backgroundColor: isTask ? accent.surface : colors.surfaceVariant }]}
      onPress={() => isTask && onToggleTask(item.id)}
      disabled={!isTask}
      accessibilityLabel={isTask ? `Toggle ${item.title}` : item.title}
    >
      <Text
        numberOfLines={1}
        style={[s.tgChipText, {
          color: done ? colors.textMuted : isTask ? accent.primary : colors.warning,
          textDecorationLine: done ? 'line-through' : 'none',
        }]}
      >
        {isTask ? item.title : `🔔 ${item.title}`}
      </Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
    todayBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    todayBtnText: { fontSize: 13, fontWeight: '600' },
    navCenter: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center' },
    navArrow: { padding: 4 },
    navTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center' },
    viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },

    pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 100, paddingRight: 12 },
    picker: { borderRadius: 12, borderWidth: 1, paddingVertical: 6, minWidth: 176 },
    pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
    pickerText: { fontSize: 15, color: colors.text },

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

    tgHead: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tgColHead: { alignItems: 'center', paddingVertical: 6, gap: 2 },
    tgDow: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase' },
    tgDayNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    tgDayNumText: { fontSize: 14, fontWeight: '600' },
    tgAllDay: { flexDirection: 'row', minHeight: 30, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tgAllDayCell: { paddingVertical: 3, paddingHorizontal: 2, gap: 2, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
    tgRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tgTime: { fontSize: 10, color: colors.textMuted, textAlign: 'right', paddingRight: 6, paddingTop: 2 },
    tgCell: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingHorizontal: 2, paddingTop: 2, gap: 2 },
    tgChip: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
    tgChipText: { fontSize: 10, fontWeight: '600' },
    tgNow: { position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'center' },
    tgNowDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.error, marginLeft: -3.5 },
    tgNowLine: { flex: 1, height: 1, backgroundColor: colors.error },
  });
}
