import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RepeatBadge from './RepeatBadge'
import { recurrenceDetail, recurrenceLabel } from '../utils/recurrence'

describe('marking a row as part of a series', () => {
  it('names the cadence', () => {
    render(<RepeatBadge recurrence={{ frequency: 'weekly', interval: 1, count: 13 }} />)
    expect(screen.getByText('Weekly')).toBeInTheDocument()
  })

  it('renders nothing at all for a one-off', () => {
    // An empty badge on every ordinary task would read as a rendering bug.
    const { container } = render(<RepeatBadge recurrence={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many are in the series on hover', () => {
    render(<RepeatBadge recurrence={{ frequency: 'weekly', interval: 1, count: 13 }} />)
    expect(screen.getByTitle('Weekly · 13 in this series')).toBeInTheDocument()
  })
})

describe('recurrence labels', () => {
  it('reads plainly at an interval of one', () => {
    expect(recurrenceLabel({ frequency: 'daily', interval: 1 })).toBe('Daily')
    expect(recurrenceLabel({ frequency: 'weekly', interval: 1 })).toBe('Weekly')
    expect(recurrenceLabel({ frequency: 'monthly', interval: 1 })).toBe('Monthly')
  })

  it('counts the gap when it is more than one', () => {
    expect(recurrenceLabel({ frequency: 'weekly', interval: 2 })).toBe('Every 2 weeks')
    expect(recurrenceLabel({ frequency: 'monthly', interval: 3 })).toBe('Every 3 months')
  })

  it('treats a missing interval as one rather than printing NaN', () => {
    expect(recurrenceLabel({ frequency: 'weekly' })).toBe('Weekly')
  })

  it('refuses anything it does not recognise', () => {
    expect(recurrenceLabel(null)).toBeNull()
    expect(recurrenceLabel({})).toBeNull()
    expect(recurrenceLabel({ frequency: 'hourly', interval: 1 })).toBeNull()
  })

  it('drops the count from the detail when there is only one', () => {
    expect(recurrenceDetail({ frequency: 'weekly', interval: 1, count: 1 })).toBe('Weekly')
  })
})
