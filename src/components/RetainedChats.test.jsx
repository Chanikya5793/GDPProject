import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RetainedChats, { daysLeft, spokenMoment } from './RetainedChats'

const exchange = (overrides = {}) => ({
  request_id: 'chat-1',
  question: 'What is due today?',
  answer: 'Two things: Chemistry revision and the essay outline.',
  citations: [{ citation_id: 'S1' }],
  created_at: '2026-09-02T14:30:00Z',
  expires_at: '2026-10-02T14:30:00Z',
  ...overrides,
})

describe('retained chat history', () => {
  it('shows what retention actually kept', () => {
    // These rows used to be write-only: the sole lookup was by request_id,
    // which the client never reuses, so nothing could ever display them.
    render(<RetainedChats chats={[exchange()]} status="ready" retainOn
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('What is due today?')).toBeInTheDocument()
    expect(screen.getByText(/Chemistry revision/)).toBeInTheDocument()
    expect(screen.getByText(/1 stored/)).toBeInTheDocument()
  })

  it('deletes one exchange without touching the rest', () => {
    const remove = vi.fn()
    render(<RetainedChats status="ready" retainOn onRefresh={vi.fn()} onDelete={remove}
      chats={[exchange(), exchange({ request_id: 'chat-2', question: 'And tomorrow?' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete "And tomorrow\?"/ }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0].request_id).toBe('chat-2')
  })

  it('explains an empty list differently depending on the switch', () => {
    const { rerender } = render(<RetainedChats chats={[]} status="ready" retainOn
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/Nothing has been kept yet/)).toBeInTheDocument()
    rerender(<RetainedChats chats={[]} status="ready" retainOn={false}
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/Retention is off/)).toBeInTheDocument()
  })

  it('surfaces a failed load rather than looking empty', () => {
    render(<RetainedChats chats={[]} status="error" error="Planner request failed (503)"
      retainOn onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/Planner request failed/)).toBeInTheDocument()
  })
})

describe('how long an exchange has left', () => {
  const now = Date.parse('2026-09-02T00:00:00Z')

  it('counts whole days until it is swept', () => {
    expect(daysLeft('2026-09-09T00:00:00Z', now)).toBe(7)
  })

  it('never rounds a live exchange down to nothing', () => {
    // An hour left is still a day the student can act on, not zero.
    expect(daysLeft('2026-09-02T01:00:00Z', now)).toBe(1)
  })

  it('reports one already due as due', () => {
    expect(daysLeft('2026-09-01T00:00:00Z', now)).toBeNull()
  })

  it('does not print Invalid Date when a timestamp is missing', () => {
    expect(spokenMoment(undefined)).toBe('')
  })
})
