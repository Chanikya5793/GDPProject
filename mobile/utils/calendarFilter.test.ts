import { describe, expect, it } from 'vitest';

import {
  ALL_CATEGORIES, buildItemsByDate, calendarCategories, CalendarFilter, DEFAULT_FILTER,
  isFiltered, reconcileCategory,
} from './calendarFilter';
import { Reminder, Task } from '@/types';

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id, userId: 'u1', title: `Task ${id}`, dueDate: '2026-08-27', dueTime: '',
    priority: 'medium', category: 'Homework', notes: '', completed: false,
    createdAt: '2026-08-01T00:00:00.000Z', ...overrides,
  } as Task;
}

function reminder(id: number, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id, userId: 'u1', title: `Reminder ${id}`, date: '2026-08-27', time: '',
    notes: '', createdAt: '2026-08-01T00:00:00.000Z', ...overrides,
  } as Reminder;
}

describe('calendarCategories', () => {
  it('lists the categories in use, sorted and deduplicated', () => {
    expect(calendarCategories([
      task(1, { category: 'Reading' }),
      task(2, { category: 'Exam' }),
      task(3, { category: 'Reading' }),
    ])).toEqual(['Exam', 'Reading']);
  });

  it('drops blank categories rather than offering an empty option', () => {
    expect(calendarCategories([task(1, { category: '' }), task(2, { category: 'Exam' })]))
      .toEqual(['Exam']);
  });

  it('is empty when there are no tasks', () => {
    expect(calendarCategories([])).toEqual([]);
  });
});

describe('buildItemsByDate', () => {
  const tasks = [
    task(1, { dueDate: '2026-08-27', category: 'Exam' }),
    task(2, { dueDate: '2026-08-28', category: 'Reading' }),
  ];
  const reminders = [reminder(9, { date: '2026-08-27' })];

  it('groups everything by date by default', () => {
    const map = buildItemsByDate(tasks, reminders);
    expect(Object.keys(map).sort()).toEqual(['2026-08-27', '2026-08-28']);
    expect(map['2026-08-27'].map(i => i._type)).toEqual(['task', 'reminder']);
  });

  it('tags each item with its type', () => {
    const map = buildItemsByDate(tasks, reminders);
    expect(map['2026-08-28'][0]).toMatchObject({ id: 2, _type: 'task' });
  });

  it('skips items with no date', () => {
    // A task with no due date belongs on no day; web skips it the same way.
    const map = buildItemsByDate([task(3, { dueDate: '' })], [reminder(4, { date: '' })]);
    expect(map).toEqual({});
  });

  it('hides tasks when they are toggled off', () => {
    const map = buildItemsByDate(tasks, reminders, { ...DEFAULT_FILTER, showTasks: false });
    expect(map['2026-08-27'].map(i => i._type)).toEqual(['reminder']);
    expect(map['2026-08-28']).toBeUndefined();
  });

  it('hides reminders when they are toggled off', () => {
    const map = buildItemsByDate(tasks, reminders, { ...DEFAULT_FILTER, showReminders: false });
    expect(map['2026-08-27'].map(i => i._type)).toEqual(['task']);
  });

  it('is empty when both are toggled off', () => {
    expect(buildItemsByDate(tasks, reminders, {
      showTasks: false, showReminders: false, category: ALL_CATEGORIES,
    })).toEqual({});
  });

  it('narrows tasks to one category', () => {
    const map = buildItemsByDate(tasks, reminders, { ...DEFAULT_FILTER, category: 'Exam' });
    expect(map['2026-08-27'].map(i => i.id)).toEqual([1, 9]);
    expect(map['2026-08-28']).toBeUndefined();
  });

  it('leaves reminders alone when a category is selected', () => {
    // Reminders carry no category, so a category filter must not silently hide
    // them — the legend toggle is how you hide reminders.
    const map = buildItemsByDate(tasks, reminders, { ...DEFAULT_FILTER, category: 'Reading' });
    expect(map['2026-08-27'].map(i => i._type)).toEqual(['reminder']);
  });

  it('combines a category with a hidden type', () => {
    const map = buildItemsByDate(tasks, reminders, {
      showTasks: true, showReminders: false, category: 'Exam',
    });
    expect(Object.keys(map)).toEqual(['2026-08-27']);
    expect(map['2026-08-27'].map(i => i.id)).toEqual([1]);
  });

  it('does not mutate the tasks it was given', () => {
    const source = [task(1)];
    buildItemsByDate(source, []);
    expect(source[0]).not.toHaveProperty('_type');
  });
});

describe('isFiltered', () => {
  it('is false for the default filter', () => {
    expect(isFiltered(DEFAULT_FILTER)).toBe(false);
  });

  it('is true when anything is narrowed', () => {
    const cases: CalendarFilter[] = [
      { ...DEFAULT_FILTER, showTasks: false },
      { ...DEFAULT_FILTER, showReminders: false },
      { ...DEFAULT_FILTER, category: 'Exam' },
    ];
    for (const filter of cases) expect(isFiltered(filter)).toBe(true);
  });
});

describe('reconcileCategory', () => {
  it('keeps a category that still exists', () => {
    const filter = { ...DEFAULT_FILTER, category: 'Exam' };
    expect(reconcileCategory(filter, ['Exam', 'Reading'])).toBe(filter);
  });

  it('resets a category that has disappeared', () => {
    // Deleting the last Exam task would otherwise leave the calendar empty
    // with no visible reason: the picker would not even list Exam any more.
    expect(reconcileCategory({ ...DEFAULT_FILTER, category: 'Exam' }, ['Reading']))
      .toEqual(DEFAULT_FILTER);
  });

  it('leaves the all-categories selection alone even with no categories', () => {
    expect(reconcileCategory(DEFAULT_FILTER, [])).toBe(DEFAULT_FILTER);
  });

  it('preserves the type toggles when it resets the category', () => {
    const filter = { showTasks: false, showReminders: true, category: 'Exam' };
    expect(reconcileCategory(filter, [])).toEqual({ ...filter, category: ALL_CATEGORIES });
  });
});
