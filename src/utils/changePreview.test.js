import { describe, expect, it } from 'vitest'
import { changeLines, changeSummary, spokenDate, spokenTime, spokenWhen } from './changePreview'

describe('what a change looks like to a person', () => {
  it('reads a new record as what it adds, not as a JSON object', () => {
    // The preview used to be JSON.stringify of the record, so asking for a
    // reminder produced a wall of braces and snake_case keys.
    const lines = changeLines({
      operation: 'create', before: null,
      after: { title: 'Fill Microsoft Form', date: '2026-09-04', time: '13:30' },
    })
    expect(lines).toEqual([
      { label: 'Adds', to: 'Fill Microsoft Form' },
      { label: 'When', to: 'Fri 4 Sep at 1:30 PM' },
    ])
  })

  it('lists only what actually moves on an edit', () => {
    const lines = changeLines({
      operation: 'reschedule',
      before: { title: 'Lab report', due_date: '2026-08-28', priority: 'high' },
      after: { title: 'Lab report', due_date: '2026-09-04', priority: 'high' },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ label: 'Date', from: 'Fri 28 Aug', to: 'Fri 4 Sep' })
  })

  it('says plainly when a record is being removed', () => {
    expect(changeLines({ operation: 'delete', before: { title: 'Old quiz' }, after: null }))
      .toEqual([{ label: 'Deletes', to: 'Old quiz' }])
  })

  it('summarises a change in one line for a batch', () => {
    expect(changeSummary({
      operation: 'reschedule',
      before: { title: 'Lab report', due_date: '2026-08-28' },
      after: { title: 'Lab report', due_date: '2026-09-04' },
    })).toBe('Lab report · Date Fri 28 Aug → Fri 4 Sep')
  })

  it('never renders an empty change as a blank card', () => {
    const lines = changeLines({
      operation: 'update',
      before: { title: 'Same' }, after: { title: 'Same' },
    })
    expect(lines[0].label).toBe('No visible change')
  })
})

describe('saying dates and times out loud', () => {
  it('reads a date the way a person does', () => {
    expect(spokenDate('2026-09-04')).toBe('Fri 4 Sep')
  })

  it('reads a 24-hour time as a clock reading', () => {
    expect(spokenTime('13:30')).toBe('1:30 PM')
    expect(spokenTime('00:05')).toBe('12:05 AM')
    expect(spokenTime('12:00')).toBe('12:00 PM')
  })

  it('handles a record with no date at all', () => {
    expect(spokenWhen({ title: 'Someday' })).toBe('no date')
    expect(spokenDate(null)).toBe('')
  })
})
