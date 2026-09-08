// What the home screen widgets are allowed to say, and when it changes.
//
// Pure and clock-free, like utils/notificationPlan.ts, for the same reason:
// this decides what leaves the app's encrypted store, so it should be readable
// and testable on its own rather than tangled up with WidgetKit.
//
// The privacy shape matters more here than anywhere else in the app. Records
// live encrypted under a per-user key (see api/storage.ts), but a widget cannot
// read that: WidgetKit runs in a separate process and reads a plain,
// unencrypted App Group container that survives sign-out and is not scoped to a
// user. So the default is counts and times — "3 due today, next at 5:00 PM" —
// which is most of the value of a glanceable widget and almost none of the
// exposure. Titles are opt-in in Settings, and a widget can only ever narrow
// that further, never widen it.
//
// One props shape feeds every widget. That is deliberate: a widget's
// configuration is applied when the layout renders, not when the timeline is
// built — the generated timeline provider reads the same stored entries
// whatever the student picked in Edit Widget. So the app pushes the superset
// and each layout filters it down.

import { Reminder, Task } from '@/types';
import { parseLocalDateTime } from './notificationPlan';

/** Long enough to survive a night, and to fill the week view. */
export const TIMELINE_HORIZON_HOURS = 36;

/** Entries repeat the whole props object, so this is a size budget too. */
export const MAX_TIMELINE_ENTRIES = 8;

/** How far ahead items are published, so "this week" has something to show. */
export const ITEM_HORIZON_DAYS = 7;

/** More than a widget can show at any size, with room for filtering. */
export const MAX_ITEMS = 10;

/** Trimmed hard: a widget has no room for a sentence, and less is safer. */
export const MAX_TITLE_LENGTH = 34;

const DAY_MS = 86_400_000;

export interface WidgetItem {
  id: string;
  kind: 'task' | 'reminder';
  /** Empty unless the student allowed titles on widgets. */
  title: string;
  /** Epoch milliseconds. Layouts rebuild a Date from this for live countdowns. */
  at: number;
  category: string;
  priority: 'high' | 'medium' | 'low' | '';
  done: boolean;
}

export interface DayLoad {
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
  /** Single letter for the widget's axis. */
  label: string;
  count: number;
  isToday: boolean;
}

export interface WidgetProps {
  /** Upcoming and overdue-today items, nearest first. */
  items: WidgetItem[];
  dueToday: number;
  overdue: number;
  doneToday: number;
  /** Done plus outstanding, so a ring has a denominator. */
  totalToday: number;
  /** Seven days from today, for the week view. */
  days: DayLoad[];
  /** Epoch ms of the next thing left today, or 0. */
  nextAt: number;
  /** Whether Settings allows titles to leave the encrypted store at all. */
  titlesAllowed: boolean;
  /** True when the student has nothing scheduled at all. */
  empty: boolean;
}

export const EMPTY_WIDGET_PROPS: WidgetProps = {
  items: [], dueToday: 0, overdue: 0, doneToday: 0, totalToday: 0,
  days: [], nextAt: 0, titlesAllowed: false, empty: true,
};

export interface SnapshotInput {
  tasks: Task[];
  reminders: Reminder[];
  /** Epoch milliseconds. */
  now: number;
  /** False keeps every title inside the encrypted store. */
  showTitles: boolean;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function truncate(title: string): string {
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

/** Every dated record as a widget item, in order, titles applied or withheld. */
function collect(input: SnapshotInput): WidgetItem[] {
  const items: WidgetItem[] = [];
  const title = (value: string) => (input.showTitles ? truncate((value || '').trim()) : '');

  for (const task of input.tasks) {
    const at = parseLocalDateTime(task.dueDate, task.dueTime);
    if (at === null) continue;
    items.push({
      id: String(task.id), kind: 'task', title: title(task.title), at,
      category: task.category || '', priority: task.priority || '',
      done: Boolean(task.completed),
    });
  }
  for (const reminder of input.reminders) {
    const at = parseLocalDateTime(reminder.date, reminder.time);
    if (at === null) continue;
    items.push({
      id: String(reminder.id), kind: 'reminder', title: title(reminder.title), at,
      category: '', priority: '',
      done: Boolean(reminder.completed),
    });
  }
  return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Seven days from today with how much lands on each. */
function weekLoad(items: WidgetItem[], now: number): DayLoad[] {
  const today = startOfDay(now);
  return Array.from({ length: 7 }, (_, offset) => {
    const dayStart = today + offset * DAY_MS;
    const weekday = new Date(dayStart).getDay();
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      count: items.filter(
        item => !item.done && item.at >= dayStart && item.at < dayStart + DAY_MS,
      ).length,
      isToday: offset === 0,
    };
  });
}

/**
 * What the widgets should show at a given moment.
 *
 * Counts are for the day `now` falls in, so the same records produce different
 * props at 11pm and at 1am — which is what the timeline below exists to
 * schedule, since no code of ours runs at midnight to do it.
 */
export function buildWidgetSnapshot(input: SnapshotInput): WidgetProps {
  const { now } = input;
  const all = collect(input);
  if (all.length === 0) return { ...EMPTY_WIDGET_PROPS, titlesAllowed: input.showTitles };

  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;
  const horizon = today + ITEM_HORIZON_DAYS * DAY_MS;

  const dueToday = all.filter(item => !item.done && item.at >= today && item.at < tomorrow);
  const overdue = all.filter(item => !item.done && item.at < today);
  const doneToday = all.filter(item => item.done && item.at >= today && item.at < tomorrow);
  const next = dueToday.find(item => item.at > now);

  // Overdue work leads, because it is the thing most worth acting on, then
  // everything upcoming inside the week the "this week" view covers.
  const published = [
    ...overdue,
    ...all.filter(item => !item.done && item.at >= today && item.at < horizon),
  ].slice(0, MAX_ITEMS);

  return {
    items: published,
    dueToday: dueToday.length,
    overdue: overdue.length,
    doneToday: doneToday.length,
    totalToday: dueToday.length + doneToday.length,
    days: weekLoad(all, now),
    nextAt: next ? next.at : 0,
    titlesAllowed: input.showTitles,
    empty: false,
  };
}

export interface TimelineEntry {
  date: Date;
  props: WidgetProps;
}

/**
 * A run of snapshots covering the next day and a half.
 *
 * Widgets get no background JavaScript: once the app is closed, the only thing
 * that changes them is an entry scheduled in advance. So the moments that would
 * visibly change the display are enumerated up front — each upcoming item,
 * because it stops being "next" once it passes, and midnight, because that is
 * when today's count becomes tomorrow's.
 *
 * Live countdowns are deliberately not in here. A layout can render a ticking
 * "in 2h 14m" from an item's timestamp on its own, which costs no entries at
 * all; spending them on clock ticks would exhaust the budget by lunchtime.
 */
export function buildWidgetTimeline(input: SnapshotInput): TimelineEntry[] {
  const { now } = input;
  const horizon = now + TIMELINE_HORIZON_HOURS * 3_600_000;
  const midnight = startOfDay(now) + DAY_MS;

  const moments = new Set<number>([now, midnight]);
  for (const item of collect(input)) {
    // A moment one second past the item: at exactly `item.at` it is still
    // "now", and the widget should keep showing it until it has passed.
    if (item.at > now && item.at <= horizon) moments.add(item.at + 1000);
  }

  return [...moments]
    .filter(at => at <= horizon)
    .sort((a, b) => a - b)
    .slice(0, MAX_TIMELINE_ENTRIES)
    .map(at => ({ date: new Date(at), props: buildWidgetSnapshot({ ...input, now: at }) }));
}
