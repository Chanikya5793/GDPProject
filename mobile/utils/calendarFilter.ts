// Which calendar items are shown.
//
// Mirrors the legend and category select in web's calendar header
// (src/pages/Calendar.jsx): tasks and reminders toggle independently, and a
// category narrows the tasks. Reminders carry no category, so the category
// filter never applies to them — hiding reminders is what the legend is for.
//
// Pure, so the bucketing and the filter rules are tested rather than only
// exercised by tapping through the calendar.

import { Reminder, Task } from '@/types';

export type CalItem = (Task & { _type: 'task' }) | (Reminder & { _type: 'reminder' });

export const ALL_CATEGORIES = 'all';

export interface CalendarFilter {
  showTasks: boolean;
  showReminders: boolean;
  /** A category name, or ALL_CATEGORIES. */
  category: string;
}

export const DEFAULT_FILTER: CalendarFilter = {
  showTasks: true,
  showReminders: true,
  category: ALL_CATEGORIES,
};

/**
 * The categories worth offering: the ones tasks actually use, sorted.
 *
 * Taken from the tasks rather than the categories API, as web does, so the
 * picker never offers a category that would filter the calendar down to
 * nothing.
 */
export function calendarCategories(tasks: Task[]): string[] {
  return [...new Set(tasks.map(task => task.category).filter(Boolean))].sort();
}

/** Group the visible tasks and reminders by their date. */
export function buildItemsByDate(
  tasks: Task[],
  reminders: Reminder[],
  filter: CalendarFilter = DEFAULT_FILTER,
): Record<string, CalItem[]> {
  const map: Record<string, CalItem[]> = {};
  if (filter.showTasks) {
    for (const task of tasks) {
      if (!task.dueDate) continue;
      if (filter.category !== ALL_CATEGORIES && task.category !== filter.category) continue;
      (map[task.dueDate] ||= []).push({ ...task, _type: 'task' });
    }
  }
  if (filter.showReminders) {
    for (const reminder of reminders) {
      if (!reminder.date) continue;
      (map[reminder.date] ||= []).push({ ...reminder, _type: 'reminder' });
    }
  }
  return map;
}

/** True when anything is being hidden — used to mark the filter control. */
export function isFiltered(filter: CalendarFilter): boolean {
  return !filter.showTasks || !filter.showReminders || filter.category !== ALL_CATEGORIES;
}

/**
 * Reset a category that no longer exists.
 *
 * The last task in a category can be deleted or recategorised while it is
 * selected, which would otherwise leave the calendar permanently empty with no
 * visible reason — the picker would not even list the category being filtered on.
 */
export function reconcileCategory(filter: CalendarFilter, available: string[]): CalendarFilter {
  if (filter.category === ALL_CATEGORIES || available.includes(filter.category)) return filter;
  return { ...filter, category: ALL_CATEGORIES };
}
