import { Task } from '@/types';

export type EscalatedPriority = {
  effective: Task['priority'];
  original: Task['priority'];
  wasEscalated: boolean;
  daysUntilDue: number;
};

export type OverloadedDay = {
  date: string;
  tasks: Task[];
};

export type RescheduleSuggestion = {
  task: Task;
  from: string;
  to: string;
};

// ─── date helpers ─────────────────────────────────────────────────────────────

export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Returns calendar days between today (midnight) and the given due date.
 * Negative = overdue, 0 = due today, Infinity = no due date.
 */
export function getDaysUntilDue(dueDateStr: string): number {
  if (!dueDateStr) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

/**
 * Computes the effective (display) priority for a task based on deadline proximity.
 *
 * Escalation rules (incomplete tasks only):
 *   - Overdue / due today  (≤ 0 days) → force HIGH
 *   - Due tomorrow          (1 day)    → escalate LOW/MEDIUM → HIGH
 *   - Due in 2–3 days                  → escalate LOW → MEDIUM
 *   - Due in 4 days                    → escalate LOW → MEDIUM  (mild)
 *   Completed tasks are never escalated.
 */
export function getEffectivePriority(task: Task): EscalatedPriority {
  const daysUntilDue = getDaysUntilDue(task.dueDate);
  const original = task.priority;
  let effective: Task['priority'] = original;

  if (!task.completed && task.dueDate) {
    if (daysUntilDue <= 1) {
      effective = 'high';
    } else if (daysUntilDue <= 3) {
      if (original === 'low') effective = 'medium';
    } else if (daysUntilDue <= 4) {
      if (original === 'low') effective = 'medium';
    }
  }

  return { effective, original, wasEscalated: effective !== original, daysUntilDue };
}

// ─── overload detection ───────────────────────────────────────────────────────

/**
 * Finds FUTURE dates (> today) with >= `threshold` incomplete tasks (default 3).
 * Today and overdue dates are excluded — you can't pull those any earlier.
 */
export function detectOverloadedDays(
  tasks: Task[],
  threshold = 3,
): OverloadedDay[] {
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

// ─── pull-forward rescheduling ────────────────────────────────────────────────

const PRIORITY_ORDER: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

/**
 * For each overloaded future day, suggests PULLING lower-priority tasks
 * FORWARD to earlier available dates (between today+1 and the overloaded day-1).
 * Never pushes tasks to a later date.
 *
 * Strategy: keep the `keepPerDay` highest-priority tasks on the original date;
 * suggest the rest be moved to the earliest available slot BEFORE that date.
 */
export function suggestReschedule(
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
    // Sort: highest priority first, then by creation date (oldest first)
    const sorted = [...day.tasks].sort((a, b) =>
      PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]
        ? PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Keep top keepPerDay; suggest pulling the rest EARLIER
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

/** Friendly label for a date string relative to today */
export function friendlyDate(dateStr: string): string {
  const days = getDaysUntilDue(dateStr);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
