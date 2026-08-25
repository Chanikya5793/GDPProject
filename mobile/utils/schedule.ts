// Workload balancing for the Tasks screen.
//
// Mirrors src/utils/schedule.js in the web app so both clients agree on what an
// overloaded day is and which task moves. Pure functions with no React Native
// imports, so they run under vitest in plain node. Every function takes the
// "today" boundary as an argument rather than reading the clock, which keeps the
// tests deterministic.

import { PlannerRecordId } from '@/types';

export const DEFAULT_DAILY_TASK_LIMIT = 2;

const PRIO_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** The minimum shape balancing needs; the real Task satisfies it. */
export interface BalanceableTask {
  id: PlannerRecordId;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  createdAt: string;
}

export interface OverloadedDay<T extends BalanceableTask> {
  date: string;
  tasks: T[];
}

export interface RescheduleSuggestion<T extends BalanceableTask> {
  task: T;
  from: string;
  to: string;
}

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return localDateStr();
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

/**
 * Future days holding more incomplete tasks than `limit`.
 *
 * Today and overdue days are excluded: rescheduling only ever pulls work
 * earlier, and there is no earlier slot than today.
 */
export function detectOverloadedDays<T extends BalanceableTask>(
  tasks: T[],
  limit: number = DEFAULT_DAILY_TASK_LIMIT,
  from: string = todayStr(),
): OverloadedDay<T>[] {
  const active = tasks.filter(task => !task.completed && task.dueDate && task.dueDate > from);
  const byDate: Record<string, T[]> = {};
  for (const task of active) {
    byDate[task.dueDate] = byDate[task.dueDate] || [];
    byDate[task.dueDate].push(task);
  }
  return Object.entries(byDate)
    .filter(([, dayTasks]) => dayTasks.length > limit)
    .map(([date, dayTasks]) => ({ date, tasks: dayTasks }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Proposes pulling the lowest-priority overflow off each crowded day onto the
 * nearest earlier day that still has room. Never pushes a task later, and never
 * targets today or the past.
 *
 * `skipIds` holds tasks that auto-balance has already moved once. Honouring it
 * is what stops the automatic pass from shuffling the same task back and forth
 * on every render.
 */
export function suggestReschedule<T extends BalanceableTask>(
  overloadedDays: OverloadedDay<T>[],
  allTasks: T[],
  limit: number = DEFAULT_DAILY_TASK_LIMIT,
  from: string = todayStr(),
  skipIds: Set<PlannerRecordId> = new Set(),
): RescheduleSuggestion<T>[] {
  // Live count per day so each proposal reserves its target slot and later
  // proposals see the day as fuller.
  const countByDate: Record<string, number> = {};
  for (const task of allTasks.filter(t => !t.completed && t.dueDate)) {
    countByDate[task.dueDate] = (countByDate[task.dueDate] || 0) + 1;
  }

  const suggestions: RescheduleSuggestion<T>[] = [];
  for (const day of overloadedDays) {
    const ranked = [...day.tasks].sort((a, b) =>
      PRIO_ORDER[a.priority] !== PRIO_ORDER[b.priority]
        ? (PRIO_ORDER[a.priority] ?? 3) - (PRIO_ORDER[b.priority] ?? 3)
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    for (const task of ranked.slice(limit)) {
      if (skipIds.has(task.id)) continue;
      let target: string | null = null;
      for (let offset = 1; ; offset++) {
        const candidate = shiftDate(day.date, -offset);
        if (candidate <= from) break;
        if ((countByDate[candidate] || 0) < limit) {
          target = candidate;
          break;
        }
      }
      if (target) {
        countByDate[target] = (countByDate[target] || 0) + 1;
        countByDate[day.date] = Math.max(0, (countByDate[day.date] || 1) - 1);
        suggestions.push({ task, from: day.date, to: target });
      }
    }
  }
  return suggestions;
}
