import { describe, expect, it } from 'vitest'
import { toTraceRecord, traceInputFor } from './traceInput'

describe('toTraceRecord', () => {
  it('turns the client\'s empty strings back into the server\'s nulls', () => {
    const reminder = toTraceRecord('reminder', { id: 'r1', title: 'Call advisor', date: '2026-10-20', time: '', notes: '' })
    expect(reminder.time).toBeNull()
    const task = toTraceRecord('task', { id: 't1', title: 'Report', dueDate: '', dueTime: '', _approvedForAi: false })
    expect(task.dueDate).toBeNull()
    expect(task.approvedForAi).toBe(false)
    expect(task.priority).toBe('medium')
  })
})

describe('traceInputFor', () => {
  const messages = [
    { id: 'u0', role: 'user', text: 'What is due this week?' },
    { id: 'b0', role: 'bot', text: 'The GDP report.', citations: [{ citation_id: 'S1', record_id: 't1', title: 'Submit GDP report' }] },
    { id: 'e0', role: 'error', text: 'ignored' },
    { id: 'u1', role: 'user', text: 'Move it to Friday' },
    {
      id: 'b1', role: 'bot', text: 'Prepared a change.', steps: [{ tool: 'search', label: 'Searched' }],
      citations: [{ citation_id: 'S1', record_id: 't1' }], proposals: [{ proposal_id: 'p1' }],
      trace: { question: 'Move it to Friday', focusId: 't1', sent: 1, firstText: 2, final: 3 },
    },
  ]
  const records = [{ id: 't1', type: 'task', title: 'Submit GDP report' }]

  it('traces the question that produced the reply, with the turns before it', () => {
    const input = traceInputFor({ messages, botId: 'b1', records })
    expect(input.message).toBe('Move it to Friday')
    expect(input.history).toEqual([
      { role: 'user', text: 'What is due this week?' },
      { role: 'assistant', text: 'The GDP report.' },
    ])
    expect(input.focus).toEqual(records[0])
    expect(input.earlier).toEqual([{ citation_id: 'S1', record_id: 't1', title: 'Submit GDP report' }])
    expect(input.response.proposals).toHaveLength(1)
    expect(input.timings).toEqual({ sent: 1, firstText: 2, final: 3 })
    expect(input.demo).toBe(false)
  })

  it('passes the server\'s retrieval funnel through untouched', () => {
    const searches = [{ query: 'q', requested: 25, limit: 5, max_distance: 0.98, candidates: [{ rank: 1, distance: 0.6, outcome: 'kept', entity_type: 'task', record_id: 't1', citation_id: 'S1' }] }]
    const withSearch = messages.map(m => (m.id === 'b1' ? { ...m, retrieval: { attempted: true, result_count: 1, searches } } : m))
    const input = traceInputFor({ messages: withSearch, botId: 'b1', records })
    expect(input.response.retrieval.searches).toEqual(searches)
  })

  it('falls back to the user message for replies saved before tracing existed', () => {
    const input = traceInputFor({ messages: messages.slice(0, 2), botId: 'b0', records })
    expect(input.message).toBe('What is due this week?')
    expect(input.history).toEqual([])
    expect(input.focus).toBeNull()
    expect(input.timings).toBeNull()
  })
})
