import { describe, expect, it } from 'vitest';
import { Reminder, Task } from '@/types';
import {
  buildWidgetSnapshot,
  buildWidgetTimeline,
  MAX_ITEMS,
  MAX_TIMELINE_ENTRIES,
  MAX_TITLE_LENGTH,
} from './widgetSnapshot';

const NOW = new Date(2026, 8, 7, 8, 0).getTime(); // Mon 2026-09-07, 08:00 local

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', userId: 'u1', title: 'Essay draft',
    dueDate: '2026-09-07', dueTime: '17:00',
    priority: 'medium', category: 'Homework', notes: '',
    completed: false, createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1', userId: 'u1', title: 'Office hours',
    date: '2026-09-07', time: '14:00', notes: '',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function snap(tasks: Task[], reminders: Reminder[] = [], showTitles = false) {
  return buildWidgetSnapshot({ tasks, reminders, now: NOW, showTitles });
}

describe('buildWidgetSnapshot', () => {
  it('counts today across tasks and reminders', () => {
    const result = snap([task()], [reminder()]);
    expect(result.dueToday).toBe(2);
    expect(result.overdue).toBe(0);
  });

  it('names the next moment left today as a timestamp a layout can count down from', () => {
    expect(snap([task()], [reminder()]).nextAt).toBe(new Date(2026, 8, 7, 14, 0).getTime());
  });

  it('leaves nextAt at zero once the day is done', () => {
    const done = buildWidgetSnapshot({
      tasks: [task()], reminders: [], showTitles: false,
      now: new Date(2026, 8, 7, 20, 0).getTime(),
    });
    expect(done.nextAt).toBe(0);
    expect(done.dueToday).toBe(1);
  });

  it('withholds every title unless they are allowed', () => {
    const hidden = snap([task()], [reminder()]);
    expect(hidden.items.every(item => item.title === '')).toBe(true);
    expect(hidden.titlesAllowed).toBe(false);

    const shown = snap([task()], [reminder()], true);
    expect(shown.items.map(item => item.title)).toContain('Essay draft');
    expect(shown.titlesAllowed).toBe(true);
  });

  it('truncates an allowed title rather than letting it run', () => {
    const long = 'Comparative analysis of distributed consensus protocols';
    const title = snap([task({ title: long })], [], true).items[0].title;
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });

  it('separates overdue from due today and counts what is already done', () => {
    const result = snap([
      task({ id: 'old', dueDate: '2026-09-01' }),
      task({ id: 'fin', completed: true }),
      task(),
    ]);
    expect(result.overdue).toBe(1);
    expect(result.dueToday).toBe(1);
    expect(result.doneToday).toBe(1);
    expect(result.totalToday).toBe(2);
  });

  it('leads the published list with overdue work', () => {
    const result = snap([task({ id: 'old', dueDate: '2026-09-02' }), task()]);
    expect(result.items[0].id).toBe('old');
  });

  it('carries category and priority so a widget can filter on them', () => {
    const [item] = snap([task({ category: 'Exam', priority: 'high' })]).items;
    expect(item.category).toBe('Exam');
    expect(item.priority).toBe('high');
    expect(item.kind).toBe('task');
  });

  it('caps how many items are published', () => {
    const many = Array.from({ length: 25 }, (_, index) => task({ id: `t${index}` }));
    expect(snap(many).items.length).toBeLessThanOrEqual(MAX_ITEMS);
  });

  it('builds a seven-day load starting today', () => {
    const result = snap([task(), task({ id: 't2', dueDate: '2026-09-09' })]);
    expect(result.days).toHaveLength(7);
    expect(result.days[0].isToday).toBe(true);
    expect(result.days[0].label).toBe('M');
    expect(result.days[0].count).toBe(1);
    expect(result.days[2].count).toBe(1);
    expect(result.days[1].count).toBe(0);
  });

  it('reports an empty planner so a widget can say so', () => {
    const result = snap([], []);
    expect(result.empty).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('skips records with no date at all', () => {
    expect(snap([task({ dueDate: '' })], [reminder({ date: '' })]).empty).toBe(true);
  });
});

describe('buildWidgetTimeline', () => {
  it('starts now and crosses midnight, so counts roll over unattended', () => {
    const entries = buildWidgetTimeline({
      tasks: [task()], reminders: [], now: NOW, showTitles: false,
    });
    expect(entries[0].date.getTime()).toBe(NOW);
    const crossing = entries.find(entry => entry.date.getDate() === 8);
    expect(crossing).toBeDefined();
    expect(crossing!.props.dueToday).toBe(0);
  });

  it('adds an entry just after each upcoming item, so "next" advances', () => {
    const entries = buildWidgetTimeline({
      tasks: [task()], reminders: [reminder()], now: NOW, showTitles: false,
    });
    expect(entries[0].props.nextAt).toBe(new Date(2026, 8, 7, 14, 0).getTime());
    const afterTwo = entries.find(entry => entry.date.getHours() === 14);
    expect(afterTwo!.props.nextAt).toBe(new Date(2026, 8, 7, 17, 0).getTime());
  });

  it('returns entries in order and within the cap', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      task({ id: `t${index}`, dueTime: `${String(9 + (index % 12)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}` }));
    const entries = buildWidgetTimeline({ tasks: many, reminders: [], now: NOW, showTitles: false });
    expect(entries.length).toBeLessThanOrEqual(MAX_TIMELINE_ENTRIES);
    const times = entries.map(entry => entry.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('still schedules the midnight rollover for an empty planner', () => {
    const entries = buildWidgetTimeline({ tasks: [], reminders: [], now: NOW, showTitles: false });
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.props.empty)).toBe(true);
  });
});
