// What the phone should be told, and when.
//
// Pure by design: nothing here imports expo-notifications and nothing reads the
// clock. The records, the settings and "now" all arrive as arguments, so the
// rules that decide whether an alert fires — and which alerts survive the iOS
// pending limit — are testable in node, while the device side stays a thin
// apply step over the plan this returns.

import { Reminder, Settings, Task } from '@/types';

/**
 * iOS keeps at most 64 pending local notifications per app and drops the rest
 * silently, so a plan that overruns loses alerts without saying so. Staying
 * under the ceiling leaves room for anything scheduled outside a plan.
 */
export const NOTIFICATION_BUDGET = 56;

/** Where a record with a date but no time of its own gets its alert. */
export const DEFAULT_HOUR = 9;

/** Marks a notification as ours, so a diff never cancels someone else's. */
export const ID_PREFIX = 'nw';

export interface PlannedNotification {
  /**
   * Stable and content-derived: the same record, at the same moment, with the
   * same wording produces the same id. That is what lets an unchanged plan
   * reschedule nothing, and a changed due time replace exactly one alert.
   */
  id: string;
  title: string;
  body: string;
  /** Epoch milliseconds, in the device's own timezone. */
  at: number;
  kind: 'task' | 'reminder';
  recordId: string;
}

export interface PlanInput {
  tasks: Task[];
  reminders: Reminder[];
  settings: Pick<Settings, 'dueDateAlerts' | 'reminderDefault'>;
  /** Epoch milliseconds. Anything not strictly in the future is dropped. */
  now: number;
  budget?: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;

/**
 * A local `YYYY-MM-DD` plus optional `HH:MM` as epoch milliseconds.
 *
 * Built field by field rather than by parsing the string, because
 * `new Date('2026-09-08')` is read as UTC and lands on the previous evening for
 * anyone west of Greenwich — which is every user of this app.
 */
export function parseLocalDateTime(
  date: string,
  time: string,
  fallbackHour: number = DEFAULT_HOUR,
): number | null {
  const day = DATE_PATTERN.exec((date || '').trim());
  if (!day) return null;

  let hour = fallbackHour;
  let minute = 0;
  const clock = TIME_PATTERN.exec((time || '').trim());
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return null;
  }

  const at = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute, 0, 0);
  // Rejects the impossible dates a calendar picker can still emit, such as
  // 2026-02-30, which JavaScript would otherwise roll forward into March.
  if (at.getMonth() !== Number(day[2]) - 1 || at.getDate() !== Number(day[3])) return null;
  return at.getTime();
}

/** 24-hour input as the clock a student reads: `17:05` becomes `5:05 PM`. */
export function formatClock(at: number): string {
  const date = new Date(at);
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${((hour + 11) % 12) + 1}:${minute} ${suffix}`;
}

/** Short non-cryptographic digest, so a retitled record gets a fresh id. */
function digest(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function identify(kind: 'task' | 'reminder', recordId: string, at: number, text: string): string {
  return `${ID_PREFIX}:${kind}:${recordId}:${at}:${digest(text)}`;
}

/**
 * The alerts that should be pending right now.
 *
 * Returned nearest-first and capped: when a student has more upcoming work than
 * the device will hold, the alerts they lose should be the distant ones, not an
 * arbitrary slice. Past moments are dropped rather than fired late, and
 * completed tasks are dropped outright — being told about work already done is
 * the fastest way to teach someone to ignore the app's notifications.
 */
export function buildNotificationPlan(input: PlanInput): PlannedNotification[] {
  const { tasks, reminders, settings, now } = input;
  const budget = input.budget ?? NOTIFICATION_BUDGET;
  const leadMinutes = Math.max(0, Number(settings.reminderDefault) || 0);
  const planned: PlannedNotification[] = [];

  // Reminders fire at the moment they name. The whole point of a reminder is
  // the time on it, so no lead is subtracted.
  for (const reminder of reminders) {
    const at = parseLocalDateTime(reminder.date, reminder.time);
    if (at === null || at <= now) continue;
    const body = (reminder.notes || '').trim() || `Reminder at ${formatClock(at)}`;
    planned.push({
      id: identify('reminder', String(reminder.id), at, `${reminder.title}|${body}`),
      title: (reminder.title || 'Reminder').trim(),
      body,
      at,
      kind: 'reminder',
      recordId: String(reminder.id),
    });
  }

  // Tasks fire ahead of the deadline, by the lead time in settings, so there is
  // still time to act. A task with a due date but no due time has no deadline
  // to count back from, so it alerts in the morning instead.
  if (settings.dueDateAlerts) {
    for (const task of tasks) {
      if (task.completed) continue;
      const due = parseLocalDateTime(task.dueDate, task.dueTime);
      if (due === null) continue;
      const timed = TIME_PATTERN.test((task.dueTime || '').trim());
      const at = timed ? due - leadMinutes * 60_000 : due;
      if (at <= now) continue;
      const body = timed
        ? `Due at ${formatClock(due)}`
        : `Due today${task.category ? ` · ${task.category}` : ''}`;
      planned.push({
        id: identify('task', String(task.id), at, `${task.title}|${body}`),
        title: (task.title || 'Task').trim(),
        body,
        at,
        kind: 'task',
        recordId: String(task.id),
      });
    }
  }

  const unique = new Map(planned.map(item => [item.id, item]));
  return [...unique.values()]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, budget));
}

export interface PlanDiff {
  /** Identifiers to cancel. Only ever ours. */
  cancel: string[];
  schedule: PlannedNotification[];
}

/**
 * The smallest set of changes that turns what is pending into the plan.
 *
 * Diffing rather than cancelling everything and starting again matters because
 * rescheduling is not free and runs on every save: a student editing one task
 * should not cost fifty-six round trips to the notification centre. Pending
 * identifiers without our prefix are left completely alone.
 */
export function diffNotificationPlan(
  pendingIds: string[],
  plan: PlannedNotification[],
): PlanDiff {
  const wanted = new Set(plan.map(item => item.id));
  const pending = new Set(pendingIds.filter(id => id.startsWith(`${ID_PREFIX}:`)));
  return {
    cancel: [...pending].filter(id => !wanted.has(id)),
    schedule: plan.filter(item => !pending.has(item.id)),
  };
}
