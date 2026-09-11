import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RetainedChats, { daysLeft, spokenMoment } from './RetainedChats'

const thread = (overrides = {}) => ({
  conversation_id: 'c1',
  title: 'What is due today?',
  message_count: 4,
  created_at: '2026-09-02T14:30:00Z',
  updated_at: '2026-09-02T14:35:00Z',
  ...overrides,
})

describe('retained chat history', () => {
  it('shows the conversations that were kept', () => {
    // One place chat history is read from. It used to have its own collection,
    // so the same exchange was stored twice in two shapes.
    render(<RetainedChats chats={[thread()]} status="ready" retainOn
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('What is due today?')).toBeInTheDocument()
    expect(screen.getByText(/4 messages/)).toBeInTheDocument()
    expect(screen.getByText(/1 stored/)).toBeInTheDocument()
  })

  it('deletes one conversation without touching the rest', () => {
    const remove = vi.fn()
    render(<RetainedChats status="ready" retainOn onRefresh={vi.fn()} onDelete={remove}
      chats={[thread(), thread({ conversation_id: 'c2', title: 'And tomorrow?' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete "And tomorrow\?"/ }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0].conversation_id).toBe('c2')
  })

  it('explains an empty list differently depending on the switch', () => {
    const { rerender } = render(<RetainedChats chats={[]} status="ready" retainOn
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/Nothing has been kept yet/)).toBeInTheDocument()
    rerender(<RetainedChats chats={[]} status="ready" retainOn={false}
      onRefresh={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/Keeping conversations is off/)).toBeInTheDocument()
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
