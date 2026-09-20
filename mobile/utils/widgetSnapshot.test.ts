import { describe, expect, it } from 'vitest';
import type { Reminder, Task } from '@/types';
import { buildWidgetSnapshot, MAX_TITLE_LENGTH } from './widgetSnapshot';
import { resolveWidgetCommand, type WidgetCommand } from './widgetCommands';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 123, userId: 'student', title: 'Research outline', dueDate: '2026-09-17', dueTime: '',
  priority: 'high', category: 'Private course', notes: 'Private notes', completed: false,
  createdAt: '2026-09-01', _revision: 4, ...overrides,
});
const reminder: Reminder = { id: 'r:1', userId: 'student', title: 'Office hours', date: '2026-09-18',
  time: '14:00', notes: 'Private appointment', createdAt: '2026-09-01' };
const snapshot = (tasks: Task[], showTitles = false) => buildWidgetSnapshot({
  tasks, reminders: [reminder], now: 1000, showTitles, owner: 'opaque-owner',
});
const command = (overrides: Partial<WidgetCommand> = {}): WidgetCommand => ({
  id: 'command-1', owner: 'opaque-owner', kind: 'task', recordId: '123', revision: 4,
  date: '2026-09-17', time: '', createdAt: 2000, ...overrides,
});

describe('native widget snapshot', () => {
  it('exports only the allowed metadata, withholding titles and custom categories by default', () => {
    const value = snapshot([task()]);
    const json = JSON.stringify(value);
    for (const secret of ['Research outline', 'Private course', 'Private notes', 'Private appointment', 'Office hours', 'student']) {
      expect(json).not.toContain(secret);
    }
    expect(value.items[0]).toEqual({ id: '123', kind: 'task', title: '', date: '2026-09-17', time: '',
      category: '', priority: 'high', done: false, revision: 4, pending: false });
  });
  it('exports opted-in titles, but never notes or identity', () => {
    const value = snapshot([task()], true);
    expect(value.items[0].title).toBe('Research outline');
    expect(value.items[0].category).toBe('Private course');
    expect(JSON.stringify(value)).not.toContain('Private notes');
    expect(JSON.stringify(value)).not.toContain('userId');
  });
  it('does not lose records when the planner exceeds ten items', () => {
    const value = snapshot(Array.from({ length: 600 }, (_, index) => task({ id: index, completed: index % 2 === 0 })));
    expect(value.items).toHaveLength(601);
    expect(value.items.filter(item => item.done)).toHaveLength(300);
  });
  it('preserves date-only and undated tasks without inventing a morning deadline', () => {
    const value = snapshot([task(), task({ id: 'undated', dueDate: '' })]);
    expect(value.items[0].time).toBe('');
    expect(value.items[1].date).toBe('');
  });
  it('rejects impossible dates and malformed times', () => {
    const value = snapshot([task({ dueDate: '2026-02-30' }), task({ dueTime: '27:00' }), task({ dueTime: 'abc' })]);
    expect(value.items).toHaveLength(1);
  });
  it('bounds titles without splitting surrogate pairs', () => {
    const title = snapshot([task({ title: '🎓'.repeat(120) })], true).items[0].title;
    expect(Array.from(title)).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('\uFFFD');
  });
  it('keeps tasks and reminders with identical IDs separate', () => {
    const value = snapshot([task({ id: 'r:1' })]);
    expect(value.items.map(item => `${item.kind}:${item.id}`)).toEqual(['task:r:1', 'reminder:r:1']);
  });
});

describe('durable widget command reconciliation', () => {
  it('preserves the original ID type for the ordinary mutation endpoint', () => {
    const result = resolveWidgetCommand(command(), 'opaque-owner', [task()]);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') expect(result.record.id).toBe(123);
  });
  it('treats a replay as already applied instead of reopening the item', () => {
    expect(resolveWidgetCommand(command(), 'opaque-owner', [task({ completed: true })]).status).toBe('applied');
  });
  it('discards another account and deleted records', () => {
    expect(resolveWidgetCommand(command(), 'different-owner', [task()]).status).toBe('discard');
    expect(resolveWidgetCommand(command(), 'opaque-owner', []).status).toBe('discard');
  });
  it.each([{ _revision: 5 }, { dueDate: '2026-09-19' }, { dueTime: '16:00' }])('rejects changed records: %s', change => {
    expect(resolveWidgetCommand(command(), 'opaque-owner', [task(change)]).status).toBe('stale');
  });
  it('supports reminders and missing revisions in offline records', () => {
    const action = command({ kind: 'reminder', recordId: 'r:1', revision: null, date: reminder.date, time: reminder.time });
    expect(resolveWidgetCommand(action, 'opaque-owner', [reminder]).status).toBe('complete');
  });
});
