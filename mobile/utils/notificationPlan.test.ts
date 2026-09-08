import { describe, expect, it } from 'vitest';
import { Reminder, Settings, Task } from '@/types';
import {
  buildNotificationPlan,
  diffNotificationPlan,
  formatClock,
  ID_PREFIX,
  parseLocalDateTime,
} from './notificationPlan';

const settings: Pick<Settings, 'dueDateAlerts' | 'reminderDefault'> = {
  dueDateAlerts: true,
  reminderDefault: 30,
};

const NOW = new Date(2026, 8, 7, 8, 0).getTime(); // 2026-09-07, 08:00 local

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', userId: 'u1', title: 'Essay draft',
    dueDate: '2026-09-08', dueTime: '17:00',
    priority: 'medium', category: 'Homework', notes: '',
    completed: false, createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1', userId: 'u1', title: 'Office hours',
    date: '2026-09-08', time: '14:00', notes: '',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function plan(tasks: Task[], reminders: Reminder[], budget?: number) {
  return buildNotificationPlan({ tasks, reminders, settings, now: NOW, budget });
}

describe('parseLocalDateTime', () => {
  it('reads the date in the device timezone, not UTC', () => {
    const at = parseLocalDateTime('2026-09-08', '');
    expect(new Date(at!).getDate()).toBe(8);
    expect(new Date(at!).getHours()).toBe(9);
  });

  it('uses the time when one is given', () => {
    expect(new Date(parseLocalDateTime('2026-09-08', '17:05')!).getHours()).toBe(17);
    expect(new Date(parseLocalDateTime('2026-09-08', '17:05')!).getMinutes()).toBe(5);
  });

  it('rejects blanks, malformed dates and dates that do not exist', () => {
    expect(parseLocalDateTime('', '')).toBeNull();
    expect(parseLocalDateTime('8 Sept', '')).toBeNull();
    expect(parseLocalDateTime('2026-02-30', '')).toBeNull();
    expect(parseLocalDateTime('2026-09-08', '25:00')).toBeNull();
  });
});

describe('formatClock', () => {
  it('shows midnight and noon as twelve', () => {
    expect(formatClock(new Date(2026, 8, 8, 0, 5).getTime())).toBe('12:05 AM');
    expect(formatClock(new Date(2026, 8, 8, 12, 0).getTime())).toBe('12:00 PM');
    expect(formatClock(new Date(2026, 8, 8, 17, 30).getTime())).toBe('5:30 PM');
  });
});

describe('buildNotificationPlan', () => {
  it('alerts ahead of a timed due date by the lead time in settings', () => {
    const [alert] = plan([task()], []);
    expect(new Date(alert.at).getHours()).toBe(16);
    expect(new Date(alert.at).getMinutes()).toBe(30);
    expect(alert.body).toBe('Due at 5:00 PM');
  });

  it('alerts in the morning when a task has a date but no time', () => {
    const [alert] = plan([task({ dueTime: '' })], []);
    expect(new Date(alert.at).getHours()).toBe(9);
    expect(alert.body).toBe('Due today · Homework');
  });

  it('fires reminders at their own time, with no lead subtracted', () => {
    const [alert] = plan([], [reminder()]);
    expect(new Date(alert.at).getHours()).toBe(14);
  });

  it('prefers the reminder note to a generic body', () => {
    expect(plan([], [reminder({ notes: 'Bring the draft' })])[0].body).toBe('Bring the draft');
    expect(plan([], [reminder()])[0].body).toBe('Reminder at 2:00 PM');
  });

  it('drops completed tasks', () => {
    expect(plan([task({ completed: true })], [])).toEqual([]);
  });

  it('drops anything already past, rather than firing it late', () => {
    expect(plan([task({ dueDate: '2026-09-01' })], [reminder({ date: '2026-09-06' })])).toEqual([]);
  });

  it('drops a task whose lead time has already elapsed', () => {
    // Due 08:20 today, so a 30-minute lead points at 07:50 — already gone.
    expect(plan([task({ dueDate: '2026-09-07', dueTime: '08:20' })], [])).toEqual([]);
  });

  it('skips records with no date at all', () => {
    expect(plan([task({ dueDate: '' })], [reminder({ date: '' })])).toEqual([]);
  });

  it('honours the due date alerts switch without silencing reminders', () => {
    const off = buildNotificationPlan({
      tasks: [task()], reminders: [reminder()],
      settings: { dueDateAlerts: false, reminderDefault: 30 }, now: NOW,
    });
    expect(off.map(item => item.kind)).toEqual(['reminder']);
  });

  it('returns the nearest alerts first and keeps them when over budget', () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task({ id: `t${index}`, dueDate: `2026-09-${String(10 + index).padStart(2, '0')}` }));
    const kept = plan(tasks, [], 2);
    expect(kept.map(item => item.recordId)).toEqual(['t0', 't1']);
  });

  it('treats a zero budget as scheduling nothing', () => {
    expect(plan([task()], [], 0)).toEqual([]);
  });

  it('gives the same record the same id until something about it changes', () => {
    const before = plan([task()], [])[0].id;
    expect(plan([task()], [])[0].id).toBe(before);
    expect(plan([task({ title: 'Essay final' })], [])[0].id).not.toBe(before);
    expect(plan([task({ dueTime: '18:00' })], [])[0].id).not.toBe(before);
  });

  it('collapses duplicate records rather than alerting twice', () => {
    expect(plan([task(), task()], [])).toHaveLength(1);
  });
});

describe('diffNotificationPlan', () => {
  it('schedules only what is new and cancels only what is gone', () => {
    const wanted = plan([task()], [reminder()]);
    const { cancel, schedule } = diffNotificationPlan(
      [wanted[0].id, `${ID_PREFIX}:task:old:1:abc`],
      wanted,
    );
    expect(cancel).toEqual([`${ID_PREFIX}:task:old:1:abc`]);
    expect(schedule).toEqual([wanted[1]]);
  });

  it('does nothing when the plan already matches what is pending', () => {
    const wanted = plan([task()], [reminder()]);
    expect(diffNotificationPlan(wanted.map(item => item.id), wanted))
      .toEqual({ cancel: [], schedule: [] });
  });

  it('leaves notifications it did not schedule alone', () => {
    expect(diffNotificationPlan(['some-other-app-id'], []).cancel).toEqual([]);
  });
});
