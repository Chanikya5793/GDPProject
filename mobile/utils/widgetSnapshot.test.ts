import { describe, expect, it } from 'vitest';
import { Reminder, Task } from '@/types';
import {
  buildWidgetSnapshot,
  buildWidgetTimeline,
  MAX_TIMELINE_ENTRIES,
  MAX_TITLE_LENGTH,
} from './widgetSnapshot';

const NOW = new Date(2026, 8, 7, 8, 0).getTime(); // 2026-09-07, 08:00 local

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

  it('names the next moment left today', () => {
    expect(snap([task()], [reminder()]).nextAt).toBe('2:00 PM');
  });

  it('leaves nextAt empty once the day is done', () => {
    const done = buildWidgetSnapshot({
      tasks: [task()], reminders: [], showTitles: false,
      now: new Date(2026, 8, 7, 20, 0).getTime(),
    });
    expect(done.nextAt).toBe('');
    expect(done.dueToday).toBe(1);
  });

  it('withholds titles unless they are opted in', () => {
    expect(snap([task()]).nextTitle).toBe('');
    expect(snap([task()], [], true).nextTitle).toBe('Essay draft');
  });

  it('truncates an opted-in title rather than letting it run', () => {
    const long = 'Comparative analysis of distributed consensus protocols';
    const result = snap([task({ title: long })], [], true);
    expect(result.nextTitle.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.nextTitle.endsWith('…')).toBe(true);
  });

  it('counts past days as overdue, not as due today', () => {
    const result = snap([task({ id: 'old', dueDate: '2026-09-01' })]);
    expect(result.overdue).toBe(1);
    expect(result.dueToday).toBe(0);
  });

  it('ignores completed tasks and undated records', () => {
    expect(snap([task({ completed: true })]).empty).toBe(true);
    expect(snap([task({ dueDate: '' })]).empty).toBe(true);
  });

  it('reports an empty planner so the widget can say so', () => {
    const result = snap([], []);
    expect(result).toEqual({ dueToday: 0, overdue: 0, nextAt: '', nextTitle: '', empty: true });
  });

  it('does not treat tomorrow as today', () => {
    expect(snap([task({ dueDate: '2026-09-08' })]).dueToday).toBe(0);
  });
});

describe('buildWidgetTimeline', () => {
  it('starts now and crosses midnight, so the count rolls over unattended', () => {
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
    expect(entries[0].props.nextAt).toBe('2:00 PM');
    const afterTwo = entries.find(entry => entry.date.getHours() === 14);
    expect(afterTwo!.props.nextAt).toBe('5:00 PM');
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
