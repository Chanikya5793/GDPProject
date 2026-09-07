// What the home screen widget is allowed to say, and when it changes.
//
// Pure and clock-free, like utils/notificationPlan.ts, for the same reason:
// this decides what leaves the app's encrypted store, so it should be readable
// and testable on its own rather than tangled up with WidgetKit.
//
// The privacy shape matters more here than anywhere else in the app. Records
// live encrypted under a per-user key (see api/storage.ts), but a widget cannot
// read that: WidgetKit runs in a separate process and reads a plain, unencrypted
// App Group container that survives sign-out and is not scoped to a user. So the
// default is counts and times — "3 due today, next at 5:00 PM" — which is most
// of the value of a glanceable widget and almost none of the exposure. Titles
// are opt-in, because `accessoryRectangular` and `accessoryInline` render on the
// Lock Screen, where anyone holding the phone can read them without unlocking it.

import { Reminder, Task } from '@/types';
import { formatClock, parseLocalDateTime } from './notificationPlan';

/** Long enough to survive a night without the app being opened. */
export const TIMELINE_HORIZON_HOURS = 36;

/** WidgetKit will not render an unbounded list, and each entry costs space. */
export const MAX_TIMELINE_ENTRIES = 12;

/** Trimmed hard: a widget has no room for a sentence, and less is safer. */
export const MAX_TITLE_LENGTH = 34;

export interface WidgetProps {
  /** Incomplete tasks due today, plus reminders set for today. */
  dueToday: number;
  /** Incomplete tasks whose due date has passed. */
  overdue: number;
  /** Clock time of the next thing today, or '' when nothing is left. */
  nextAt: string;
  /** The next thing's title, or '' when titles are not opted in. */
  nextTitle: string;
  /** Set when the student has nothing scheduled at all, so the widget can say so. */
  empty: boolean;
}

export const EMPTY_WIDGET_PROPS: WidgetProps = {
  dueToday: 0, overdue: 0, nextAt: '', nextTitle: '', empty: true,
};

export interface SnapshotInput {
  tasks: Task[];
  reminders: Reminder[];
  /** Epoch milliseconds. */
  now: number;
  /** False keeps every title inside the encrypted store. */
  showTitles: boolean;
}

interface Upcoming {
  at: number;
  title: string;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** Everything with a moment attached, tasks and reminders alike, in order. */
function collect(tasks: Task[], reminders: Reminder[]): Upcoming[] {
  const items: Upcoming[] = [];
  for (const task of tasks) {
    if (task.completed) continue;
    const at = parseLocalDateTime(task.dueDate, task.dueTime);
    if (at !== null) items.push({ at, title: (task.title || '').trim() });
  }
  for (const reminder of reminders) {
    const at = parseLocalDateTime(reminder.date, reminder.time);
    if (at !== null) items.push({ at, title: (reminder.title || '').trim() });
  }
  return items.sort((a, b) => a.at - b.at);
}

function truncate(title: string): string {
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

/**
 * What the widget should show at a given moment.
 *
 * Counts are for the day `now` falls in, so the same records produce different
 * props at 11pm and at 1am — which is what the timeline below exists to
 * schedule, since no app code runs at midnight to do it.
 */
export function buildWidgetSnapshot(input: SnapshotInput): WidgetProps {
  const { now, showTitles } = input;
  const items = collect(input.tasks, input.reminders);
  if (items.length === 0) return { ...EMPTY_WIDGET_PROPS };

  const dueToday = items.filter(item => isSameDay(item.at, now)).length;
  const overdue = items.filter(item => item.at < startOfDay(now)).length;
  const next = items.find(item => item.at > now && isSameDay(item.at, now));

  return {
    dueToday,
    overdue,
    nextAt: next ? formatClock(next.at) : '',
    nextTitle: next && showTitles ? truncate(next.title) : '',
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
 * that changes the widget is an entry that was scheduled in advance. So the
 * moments that would visibly change the display are enumerated up front — each
 * upcoming item, because it stops being "next" once it passes, and midnight,
 * because that is when today's count becomes tomorrow's.
 */
export function buildWidgetTimeline(input: SnapshotInput): TimelineEntry[] {
  const { now } = input;
  const horizon = now + TIMELINE_HORIZON_HOURS * 3_600_000;
  const midnight = startOfDay(now) + 86_400_000;

  const moments = new Set<number>([now, midnight]);
  for (const item of collect(input.tasks, input.reminders)) {
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
