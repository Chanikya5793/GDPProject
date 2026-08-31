import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DAILY_TASK_LIMIT,
  detectOverloadedDays,
  suggestReschedule,
} from './schedule'

const TODAY = '2026-08-24'

let seq = 0
function task(dueDate, priority = 'medium', extra = {}) {
  seq += 1
  return {
    id: extra.id ?? `t${seq}`,
    title: extra.title ?? `Task ${seq}`,
    dueDate,
    priority,
    completed: false,
    createdAt: extra.createdAt ?? `2026-08-0${(seq % 9) + 1}T00:00:00.000Z`,
    ...extra,
  }
}

describe('detectOverloadedDays', () => {
  it('flags a day only once it exceeds the limit', () => {
    const atLimit = [task('2026-08-30'), task('2026-08-30')]
    expect(detectOverloadedDays(atLimit, 2, TODAY)).toEqual([])

    const over = [...atLimit, task('2026-08-30')]
    const flagged = detectOverloadedDays(over, 2, TODAY)
    expect(flagged).toHaveLength(1)
    expect(flagged[0].date).toBe('2026-08-30')
  })

  it('respects a custom limit in both directions', () => {
    const tasks = [task('2026-08-30'), task('2026-08-30'), task('2026-08-30')]
    expect(detectOverloadedDays(tasks, 5, TODAY)).toEqual([])
    expect(detectOverloadedDays(tasks, 1, TODAY)).toHaveLength(1)
  })

  it('ignores completed tasks, undated tasks, today, and overdue days', () => {
    const tasks = [
      task('2026-08-30', 'medium', { completed: true }),
      task('2026-08-30', 'medium', { completed: true }),
      task('2026-08-30', 'medium', { completed: true }),
      task(''), task(''), task(''),
      task(TODAY), task(TODAY), task(TODAY),
      task('2026-08-01'), task('2026-08-01'), task('2026-08-01'),
    ]
    // Nothing is pullable earlier, so nothing should be flagged.
    expect(detectOverloadedDays(tasks, 2, TODAY)).toEqual([])
  })

  it('returns crowded days in chronological order', () => {
    const tasks = [
      task('2026-09-10'), task('2026-09-10'), task('2026-09-10'),
      task('2026-08-30'), task('2026-08-30'), task('2026-08-30'),
    ]
    expect(detectOverloadedDays(tasks, 2, TODAY).map(d => d.date))
      .toEqual(['2026-08-30', '2026-09-10'])
  })

  it('defaults to the shared limit constant', () => {
    const tasks = Array.from({ length: DEFAULT_DAILY_TASK_LIMIT + 1 }, () => task('2026-08-30'))
    expect(detectOverloadedDays(tasks, undefined, TODAY)).toHaveLength(1)
  })
})

describe('suggestReschedule', () => {
  it('keeps the highest-priority tasks and pulls the overflow earlier', () => {
    const keepHigh = task('2026-08-30', 'high', { id: 'keep-high' })
    const keepMed = task('2026-08-30', 'medium', { id: 'keep-med' })
    const moveLow = task('2026-08-30', 'low', { id: 'move-low' })
    const tasks = [keepHigh, keepMed, moveLow]

    const days = detectOverloadedDays(tasks, 2, TODAY)
    const suggestions = suggestReschedule(days, tasks, 2, TODAY)

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].task.id).toBe('move-low')
    expect(suggestions[0].from).toBe('2026-08-30')
    // Nearest earlier day with room, never later than the original.
    expect(suggestions[0].to).toBe('2026-08-29')
    expect(suggestions[0].to < suggestions[0].from).toBe(true)
  })

  it('never targets today or an earlier date', () => {
    const tasks = [
      task('2026-08-25', 'high'), task('2026-08-25', 'medium'), task('2026-08-25', 'low'),
    ]
    const days = detectOverloadedDays(tasks, 2, TODAY)
    const suggestions = suggestReschedule(days, tasks, 2, TODAY)
    // The only earlier day is today itself, so there is nowhere to move to.
    expect(suggestions).toEqual([])
  })

  it('skips days that are already full and reserves each slot it uses', () => {
    const crowded = [
      task('2026-08-30', 'high'), task('2026-08-30', 'medium'),
      task('2026-08-30', 'low'), task('2026-08-30', 'low'),
    ]
    // 08-29 is already at the limit, so overflow must land on 08-28.
    const blockers = [task('2026-08-29'), task('2026-08-29')]
    const tasks = [...crowded, ...blockers]

    const days = detectOverloadedDays(tasks, 2, TODAY)
    const suggestions = suggestReschedule(days, tasks, 2, TODAY)

    expect(suggestions).toHaveLength(2)
    expect(suggestions.map(s => s.to)).toEqual(['2026-08-28', '2026-08-28'])
    expect(suggestions.every(s => s.from === '2026-08-30')).toBe(true)
  })

  it('honours skipIds so a task is never auto-moved twice', () => {
    const moveLow = task('2026-08-30', 'low', { id: 'move-low' })
    const tasks = [task('2026-08-30', 'high'), task('2026-08-30', 'medium'), moveLow]
    const days = detectOverloadedDays(tasks, 2, TODAY)

    expect(suggestReschedule(days, tasks, 2, TODAY)).toHaveLength(1)
    expect(suggestReschedule(days, tasks, 2, TODAY, new Set(['move-low']))).toEqual([])
  })

  it('produces no suggestions once the limit is raised above the load', () => {
    const tasks = [task('2026-08-30'), task('2026-08-30'), task('2026-08-30')]
    const days = detectOverloadedDays(tasks, 5, TODAY)
    expect(suggestReschedule(days, tasks, 5, TODAY)).toEqual([])
  })

  it('converges: re-running on the rebalanced result proposes nothing new', () => {
    const tasks = [
      task('2026-08-30', 'high'), task('2026-08-30', 'medium'), task('2026-08-30', 'low'),
    ]
    const first = suggestReschedule(detectOverloadedDays(tasks, 2, TODAY), tasks, 2, TODAY)

    const rebalanced = tasks.map(t => {
      const hit = first.find(s => s.task.id === t.id)
      return hit ? { ...t, dueDate: hit.to } : t
    })

    const second = suggestReschedule(detectOverloadedDays(rebalanced, 2, TODAY), rebalanced, 2, TODAY)
    expect(second).toEqual([])
  })
})
