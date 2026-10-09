import { describe, it, expect } from 'vitest'
import { groupTasksByDate } from './taskGroups'

const TODAY = '2026-10-09'
const task = (id, dueDate, completed = false) => ({ id, dueDate, completed })

describe('groupTasksByDate', () => {
  it('orders the days earliest first and puts undated tasks last', () => {
    const groups = groupTasksByDate([
      task('a', ''), task('b', '2026-10-12'), task('c', '2026-10-01'), task('d', TODAY),
    ], TODAY)
    expect(groups.map(g => g.date)).toEqual(['2026-10-01', TODAY, '2026-10-12', ''])
  })

  it('keeps the incoming order within a day', () => {
    const [group] = groupTasksByDate([task('z', TODAY), task('a', TODAY), task('m', TODAY)], TODAY)
    expect(group.tasks.map(t => t.id)).toEqual(['z', 'a', 'm'])
  })

  it('treats a missing due date like an empty one', () => {
    const groups = groupTasksByDate([{ id: 'x' }, task('y', '')], TODAY)
    expect(groups).toHaveLength(1)
    expect(groups[0].tasks.map(t => t.id)).toEqual(['x', 'y'])
  })

  it('flags a past day only while something on it is unfinished', () => {
    const groups = groupTasksByDate([
      task('open', '2026-10-01'), task('done', '2026-10-01', true),
      task('allDone', '2026-10-02', true),
    ], TODAY)
    expect(groups.map(g => [g.date, g.overdue])).toEqual([['2026-10-01', true], ['2026-10-02', false]])
  })

  it('marks today, and never flags today, future or undated groups as overdue', () => {
    const groups = groupTasksByDate([task('t', TODAY), task('f', '2026-10-10'), task('u', '')], TODAY)
    expect(groups.map(g => [g.date, g.isToday, g.overdue])).toEqual([
      [TODAY, true, false], ['2026-10-10', false, false], ['', false, false],
    ])
  })

  it('returns nothing for no tasks', () => {
    expect(groupTasksByDate([], TODAY)).toEqual([])
  })
})
