// Calendar view geometry: which dates a view covers, what its title reads, and
// how the arrows step.
//
// Mirrors the helpers at the top of src/pages/Calendar.jsx so both clients agree
// on where a week starts and what "back" means in each view. Kept free of React
// Native imports so it runs under vitest in plain node, and every function takes
// the reference date as an argument rather than reading the clock.

import { localDateStr } from './schedule';

export type CalendarView = 'day' | 'threeday' | 'workweek' | 'week' | 'month';
export type WeekStart = 'sunday' | 'monday';

/** Ordered as web's view dropdown. */
export const CALENDAR_VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'threeday', label: '3 Day' },
  { key: 'workweek', label: 'Work Week' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

function parseDate(dateStr: string): Date {
  // The T00:00:00 matters: "2026-08-26" alone parses as UTC midnight, which is
  // the previous day in any negative offset.
  return new Date(dateStr + 'T00:00:00');
}

export function shiftDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export function dayHeaders(weekStartsOn: WeekStart): string[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return weekStartsOn === 'monday' ? [...days.slice(1), days[0]] : days;
}

export function getWeekDates(refDate: string, weekStartsOn: WeekStart): string[] {
  const d = parseDate(refDate);
  const startOffset = weekStartsOn === 'monday' ? 1 : 0;
  const diff = (d.getDay() - startOffset + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDays(refDate, i - diff));
}

/** The dates a time-grid view shows. Month has no fixed span, so it returns []. */
export function getViewDates(
  selectedDate: string,
  view: CalendarView,
  weekStartsOn: WeekStart,
): string[] {
  switch (view) {
    case 'day':
      return [selectedDate];
    case 'threeday':
      return [0, 1, 2].map(i => shiftDays(selectedDate, i));
    case 'workweek': {
      // Always Mon–Fri: a work week does not move with the week-start setting.
      const day = parseDate(selectedDate).getDay();
      const toMonday = -((day + 6) % 7);
      return [0, 1, 2, 3, 4].map(i => shiftDays(selectedDate, toMonday + i));
    }
    case 'week':
      return getWeekDates(selectedDate, weekStartsOn);
    default:
      return [];
  }
}

export function getNavTitle(
  view: CalendarView,
  selectedDate: string,
  year: number,
  month: number,
  weekStartsOn: WeekStart,
): string {
  if (view === 'month') {
    return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (view === 'day') {
    return parseDate(selectedDate)
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const dates = getViewDates(selectedDate, view, weekStartsOn);
  const first = parseDate(dates[0]);
  const last = parseDate(dates[dates.length - 1]);
  if (first.getMonth() === last.getMonth()) {
    return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
  }
  return `${first.toLocaleDateString('en-US', { month: 'short' })} ${first.getDate()} - ${last.toLocaleDateString('en-US', { month: 'short' })} ${last.getDate()}, ${first.getFullYear()}`;
}

export interface CalendarCursor {
  selectedDate: string;
  year: number;
  month: number;
}

/**
 * Move the cursor one step. Month steps a month; the time-grid views step by
 * their own width, so "back" in Week lands a week earlier rather than a day.
 */
export function stepCursor(
  cursor: CalendarCursor,
  view: CalendarView,
  direction: -1 | 1,
): CalendarCursor {
  if (view === 'month') {
    const next = new Date(cursor.year, cursor.month + direction, 1);
    return { ...cursor, year: next.getFullYear(), month: next.getMonth() };
  }
  const step = view === 'day' ? 1 : view === 'threeday' ? 3 : 7;
  const selectedDate = shiftDays(cursor.selectedDate, step * direction);
  const d = parseDate(selectedDate);
  // The time-grid views drive the month strip, so keep year/month in step with
  // the date rather than letting them drift behind it.
  return { selectedDate, year: d.getFullYear(), month: d.getMonth() };
}

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/**
 * A continuous grid of real dates. Leading and trailing days spill over from the
 * neighbouring months so the first and last weeks are filled rather than blank.
 */
export function monthCells(year: number, month: number, weekStartsOn: WeekStart): MonthCell[] {
  const startOffset = weekStartsOn === 'monday' ? 1 : 0;
  const firstDay = (new Date(year, month, 1).getDay() - startOffset + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dates: Date[] = [];
  for (let i = firstDay; i > 0; i--) dates.push(new Date(year, month, 1 - i));
  for (let d = 1; d <= daysInMonth; d++) dates.push(new Date(year, month, d));
  while (dates.length % 7 !== 0) {
    const last = dates[dates.length - 1];
    dates.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }

  return dates.map(date => ({
    date: localDateStr(date),
    day: date.getDate(),
    inMonth: date.getMonth() === month && date.getFullYear() === year,
  }));
}

/** Minimum shape the grid needs off a task or reminder. */
export interface TimedItem {
  dueTime?: string;
  time?: string;
}

export function itemTime(item: TimedItem): string {
  return item.dueTime || item.time || '';
}

/** Items with no time at all — they head the all-day row instead of an hour. */
export function allDayItems<T extends TimedItem>(items: T[]): T[] {
  return items.filter(item => !itemTime(item));
}

export function itemsInHour<T extends TimedItem>(items: T[], hour: number): T[] {
  return items.filter(item => {
    const t = itemTime(item);
    return Boolean(t) && parseInt(t.split(':')[0], 10) === hour;
  });
}

/** Minutes past midnight, for placing the current-time line. */
export function minutesIntoDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
