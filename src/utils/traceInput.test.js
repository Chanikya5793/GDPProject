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
    expect(task.estimatedMinutes).toBe(30)
  })

  it('carries every field the server reads', () => {
    const task = toTraceRecord('task', { id: 't1', title: 'Report', estimatedMinutes: 90, keepScheduled: true, _revision: 4, updatedAt: '2026-10-20T10:00:00Z' })
    expect(task).toMatchObject({ estimatedMinutes: 90, keepScheduled: true, revision: 4, updatedAt: '2026-10-20T10:00:00Z' })
    const note = toTraceRecord('note', { id: 'n1', title: 'N', body: 'b', attachments: [{ text: 'syllabus', approvedForAi: true }, { name: 'empty' }] })
    expect(note.attachments).toEqual([{ text: 'syllabus', approvedForAi: true }])
    const block = toTraceRecord('schedule', { id: 's1', title: 'Lab', starts_at: '2026-10-24T15:00:00Z', ends_at: '2026-10-24T16:00:00Z' })
    expect(block).toMatchObject({ startsAt: '2026-10-24T15:00:00Z', endsAt: '2026-10-24T16:00:00Z' })
  })
})

describe('traceInputFor', () => {
  const messages = [
    { id: 'welcome', role: 'bot', text: 'Ask about planner records you have approved for AI.' },
    { id: 'u0', role: 'user', text: 'What is due this week?' },
    { id: 'b0', role: 'bot', text: 'The GDP report.', citations: [{ citation_id: 'S1', entity_type: 'task', record_id: 't1', title: 'Submit GDP report' }] },
    { id: 'e0', role: 'error', text: 'ignored' },
    { id: 'u1', role: 'user', text: 'Move it to Friday' },
    {
      id: 'b1', role: 'bot', text: 'Prepared a change.', steps: [{ tool: 'search', label: 'Searched' }],
      citations: [{ citation_id: 'S1', record_id: 't1' }], proposals: [{ proposal_id: 'p1' }],
      trace: { question: 'Move it to Friday', focusId: 't1', focusType: 'task', sent: 1, firstText: 2, final: 3 },
    },
  ]
  const records = [{ id: 't1', type: 'note', title: 'Same id, other type' }, { id: 't1', type: 'task', title: 'Submit GDP report' }]

  it('traces the question that produced the reply, with the turns before it', () => {
    const input = traceInputFor({ messages, botId: 'b1', records })
    expect(input.message).toBe('Move it to Friday')
    // The welcome blurb and failed requests are not history, as in the request.
    expect(input.history).toEqual([
      { role: 'user', text: 'What is due this week?' },
      { role: 'assistant', text: 'The GDP report.' },
    ])
    expect(input.focus).toEqual(records[1])
    expect(input.earlier).toEqual([{ citation_id: 'S1', entity_type: 'task', record_id: 't1', title: 'Submit GDP report' }])
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

  it('replays what an earlier turn proposed, as the server does', () => {
    const proposing = [
      { id: 'u0', role: 'user', text: 'Move my report' },
      {
        id: 'b0', role: 'bot', text: '1 change to confirm.',
        citations: [{ citation_id: 'S3', entity_type: 'task', record_id: 't1' }],
        proposals: [{ operation: 'update', entity_type: 'task', record_id: 't1', after: { title: 'Submit GDP report' } }],
      },
      { id: 'b9', role: 'bot', text: 'Restored.', proposed: [{ operation: 'create', entity_type: 'note', title: 'Plan' }] },
      { id: 'u1', role: 'user', text: 'make it Monday' },
      { id: 'b1', role: 'bot', text: 'Done.' },
    ]
    const input = traceInputFor({ messages: proposing, botId: 'b1', records })
    expect(input.history[1].proposed).toEqual([{ operation: 'update', entity_type: 'task', record_id: 't1', citation_id: 'S3', title: 'Submit GDP report' }])
    expect(input.history[2].proposed).toEqual([{ operation: 'create', entity_type: 'note', title: 'Plan' }])
    expect(input.history[0].proposed).toBeUndefined()
  })

  it('falls back to the user message for replies saved before tracing existed', () => {
    const input = traceInputFor({ messages: messages.slice(0, 3), botId: 'b0', records })
    expect(input.message).toBe('What is due this week?')
    expect(input.history).toEqual([])
    expect(input.focus).toBeNull()
    expect(input.timings).toBeNull()
  })
})
