import { describe, expect, it } from 'vitest';

import {
  BalanceableTask,
  DEFAULT_DAILY_TASK_LIMIT,
  detectOverloadedDays,
  suggestReschedule,
} from './schedule';

const TODAY = '2026-08-24';

let seq = 0;
function task(
  dueDate: string,
  priority: BalanceableTask['priority'] = 'medium',
  extra: Partial<BalanceableTask> = {},
): BalanceableTask {
  seq += 1;
  return {
    id: extra.id ?? `t${seq}`,
    dueDate,
    priority,
    completed: false,
    createdAt: extra.createdAt ?? `2026-08-0${(seq % 9) + 1}T00:00:00.000Z`,
    ...extra,
  };
}

describe('detectOverloadedDays', () => {
  it('flags a day only once it exceeds the limit', () => {
    const atLimit = [task('2026-08-30'), task('2026-08-30')];
    expect(detectOverloadedDays(atLimit, 2, TODAY)).toEqual([]);

    const over = [...atLimit, task('2026-08-30')];
    expect(detectOverloadedDays(over, 2, TODAY)).toHaveLength(1);
  });

  it('respects a custom limit in both directions', () => {
    const tasks = [task('2026-08-30'), task('2026-08-30'), task('2026-08-30')];
    expect(detectOverloadedDays(tasks, 5, TODAY)).toEqual([]);
    expect(detectOverloadedDays(tasks, 1, TODAY)).toHaveLength(1);
  });

  it('ignores completed, undated, today, and overdue tasks', () => {
    const tasks = [
      task('2026-08-30', 'medium', { completed: true }),
      task('2026-08-30', 'medium', { completed: true }),
      task('2026-08-30', 'medium', { completed: true }),
      task(''), task(''), task(''),
      task(TODAY), task(TODAY), task(TODAY),
      task('2026-08-01'), task('2026-08-01'), task('2026-08-01'),
    ];
    expect(detectOverloadedDays(tasks, 2, TODAY)).toEqual([]);
  });

  it('defaults to the shared limit constant', () => {
    const tasks = Array.from({ length: DEFAULT_DAILY_TASK_LIMIT + 1 }, () => task('2026-08-30'));
    expect(detectOverloadedDays(tasks, undefined, TODAY)).toHaveLength(1);
  });
});

describe('suggestReschedule', () => {
  it('keeps the highest-priority tasks and pulls the overflow earlier', () => {
    const tasks = [
      task('2026-08-30', 'high', { id: 'keep-high' }),
      task('2026-08-30', 'medium', { id: 'keep-med' }),
      task('2026-08-30', 'low', { id: 'move-low' }),
    ];
    const suggestions = suggestReschedule(detectOverloadedDays(tasks, 2, TODAY), tasks, 2, TODAY);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].task.id).toBe('move-low');
    expect(suggestions[0].to).toBe('2026-08-29');
    expect(suggestions[0].to < suggestions[0].from).toBe(true);
  });

  it('never targets today or an earlier date', () => {
    const tasks = [
      task('2026-08-25', 'high'), task('2026-08-25', 'medium'), task('2026-08-25', 'low'),
    ];
    expect(suggestReschedule(detectOverloadedDays(tasks, 2, TODAY), tasks, 2, TODAY)).toEqual([]);
  });

  it('skips full days and reserves each slot it uses', () => {
    const tasks = [
      task('2026-08-30', 'high'), task('2026-08-30', 'medium'),
      task('2026-08-30', 'low'), task('2026-08-30', 'low'),
      task('2026-08-29'), task('2026-08-29'),
    ];
    const suggestions = suggestReschedule(detectOverloadedDays(tasks, 2, TODAY), tasks, 2, TODAY);

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map(s => s.to)).toEqual(['2026-08-28', '2026-08-28']);
  });

  it('honours skipIds so a task is never auto-moved twice', () => {
    const tasks = [
      task('2026-08-30', 'high'), task('2026-08-30', 'medium'),
      task('2026-08-30', 'low', { id: 'move-low' }),
    ];
    const days = detectOverloadedDays(tasks, 2, TODAY);

    expect(suggestReschedule(days, tasks, 2, TODAY)).toHaveLength(1);
    expect(suggestReschedule(days, tasks, 2, TODAY, new Set(['move-low']))).toEqual([]);
  });

  it('converges: re-running on the rebalanced result proposes nothing new', () => {
    const tasks = [
      task('2026-08-30', 'high'), task('2026-08-30', 'medium'), task('2026-08-30', 'low'),
    ];
    const first = suggestReschedule(detectOverloadedDays(tasks, 2, TODAY), tasks, 2, TODAY);
    const rebalanced = tasks.map(t => {
      const hit = first.find(s => s.task.id === t.id);
      return hit ? { ...t, dueDate: hit.to } : t;
    });

    const second = suggestReschedule(
      detectOverloadedDays(rebalanced, 2, TODAY), rebalanced, 2, TODAY,
    );
    expect(second).toEqual([]);
  });
});
