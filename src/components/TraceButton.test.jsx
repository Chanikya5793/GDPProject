import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mountTrace = vi.fn(() => ({ close: vi.fn() }))
vi.mock('@gdp/trace/embed', () => ({ mountTrace }))
vi.mock('@gdp/trace/sample', () => ({ sampleCopilot: () => ({ message: 'sample', demo: true, records: [] }) }))
vi.mock('../api/plannerStore', () => ({
  cachedRecords: vi.fn(async type => ({
    task: [{ id: 't1', title: 'Report', dueDate: '' }],
    schedule: [{ id: 's1', title: 'Lab', starts_at: '2026-10-24T15:00:00Z', ends_at: '2026-10-24T16:00:00Z' }],
  })[type] || []),
}))

const { default: TraceButton } = await import('./TraceButton')

describe('TraceButton', () => {
  beforeEach(() => mountTrace.mockClear())

  it('opens the trace for a reply with records from this device', async () => {
    const messages = [
      { id: 'u', role: 'user', text: 'When is the report due?' },
      { id: 'b', role: 'bot', text: 'Thursday.' },
    ]
    render(<TraceButton messages={messages} botId="b" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /trace/i })) })
    expect(mountTrace).toHaveBeenCalledTimes(1)
    const { copilot } = mountTrace.mock.calls[0][0]
    expect(copilot.message).toBe('When is the report due?')
    expect(copilot.records).toEqual([
      expect.objectContaining({ id: 't1', type: 'task', dueDate: null }),
      expect.objectContaining({ id: 's1', type: 'schedule', startsAt: '2026-10-24T15:00:00Z' }),
    ])
    expect(copilot.response.answer).toBe('Thursday.')
  })

  it('traces the sample exchange in the demo', async () => {
    render(<TraceButton demo label="See how the copilot works" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /see how the copilot works/i })) })
    expect(mountTrace.mock.calls[0][0].copilot).toEqual(expect.objectContaining({ message: 'sample', demo: true }))
  })
})
