import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1', getIdToken: async () => 'test-token' } },
  firebaseConfigured: true,
  persistenceReady: Promise.resolve(),
}))

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', name: 'Sam' } }),
}))

const store = { value: null }
vi.mock('../security/cryptoStore', () => ({
  getSecureItem: vi.fn(async () => store.value),
  setSecureItem: vi.fn(async (_uid, _ns, value) => { store.value = value }),
  removeSecureItem: vi.fn(() => { store.value = null }),
}))

const streamMock = vi.fn()
vi.mock('../api/client', () => ({
  apiConfigured: () => true,
  apiFetch: vi.fn(async () => ({})),
  apiStream: (...args) => streamMock(...args),
  idempotencyKey: prefix => `${prefix}-test`,
}))

const { AiProvider, useAi } = await import('./AiContext')

const ctx = { current: null }
function Probe() {
  ctx.current = useAi()
  return (
    <ul>
      {ctx.current.messages.map(m => (
        <li key={m.id} data-role={m.role} data-streaming={String(Boolean(m.streaming))}>
          {m.text}
        </li>
      ))}
    </ul>
  )
}

const renderAi = () => render(<AiProvider><Probe /></AiProvider>)

/** Drive apiStream by handing the caller a scripted list of SSE events. */
function scripted(events) {
  return async (_path, _options, onEvent) => {
    for (const event of events) onEvent(event)
  }
}

const replies = () =>
  screen.getAllByRole('listitem').filter(node => node.dataset.role === 'bot')

describe('AiContext streaming', () => {
  beforeEach(() => {
    ctx.current = null
    streamMock.mockReset()
    store.value = null
    localStorage.clear()
  })

  it('shows text as it arrives and marks the reply as still streaming', async () => {
    let emit
    streamMock.mockImplementation(async (_p, _o, onEvent) => {
      emit = onEvent
      onEvent({ event: 'delta', data: { text: 'Start with ' } })
      onEvent({ event: 'delta', data: { text: 'the report.' } })
      // Deliberately does not finish, so the mid-stream state is observable.
      await new Promise(resolve => setTimeout(resolve, 0))
      emit({ event: 'final', data: { answer: 'Start with the report.', citations: [], proposals: [], retrieval: {} } })
    })
    renderAi()
    await act(async () => { await ctx.current.sendMessage('what first?') })
    const reply = replies().at(-1)
    expect(reply).toHaveTextContent('Start with the report.')
    expect(reply.dataset.streaming).toBe('false')
  })

  it('replaces streamed text with the final answer when the guard rewrites it', async () => {
    // The citation guard only runs once the whole document is parsed, so the
    // ungrounded sentence has already been shown. Rendering the accumulated
    // text instead of final.answer would leave it on screen.
    streamMock.mockImplementation(scripted([
      { event: 'delta', data: { text: 'You have four tasks due tomorrow.' } },
      { event: 'final', data: {
        answer: "I found related records, but I couldn't produce a source-valid answer.",
        citations: [], proposals: [], retrieval: { attempted: true, abstained: true },
      } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('what is due?') })
    const reply = replies().at(-1)
    expect(reply).toHaveTextContent(/source-valid/)
    expect(reply).not.toHaveTextContent('four tasks')
  })

  it('keeps partial text but reports an error when the stream dies mid-answer', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'delta', data: { text: 'Start with the ' } },
      { event: 'error', data: { code: 'generation_failed', detail: 'The assistant could not finish that answer.' } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('what first?') })
    expect(replies().at(-1)).toHaveTextContent('Start with the')
    expect(replies().at(-1).dataset.streaming).toBe('false')
    expect(screen.getByText(/could not finish that answer/)).toBeInTheDocument()
    expect(ctx.current.error).toMatch(/could not finish/)
  })

  it('reports a dropped connection that never sent a final event', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'delta', data: { text: 'Half an ans' } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('hello') })
    expect(screen.getByText(/connection ended/)).toBeInTheDocument()
  })

  it('surfaces the rate limit as a message rather than a silent failure', async () => {
    const failure = Object.assign(new Error('Retry in 152 seconds.'), {
      name: 'ApiError', status: 429, code: 'rate_limited',
    })
    streamMock.mockImplementation(async () => { throw failure })
    renderAi()
    await act(async () => { await ctx.current.sendMessage('hello') })
    expect(screen.getByText(/reached the copilot request limit/)).toBeInTheDocument()
  })

  it('carries proposals from the final event', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'delta', data: { text: "I'll add that." } },
      { event: 'final', data: {
        answer: "I'll add that.", citations: [], retrieval: {},
        proposals: [{ proposal_id: 'p1', status: 'pending' }],
      } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('add a task') })
    const last = ctx.current.messages.at(-1)
    expect(last.proposals).toHaveLength(1)
    expect(last.proposals[0].proposal_id).toBe('p1')
  })

  it('sends prior turns so a clarifying question can be answered', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'final', data: { answer: 'Which class?', citations: [], proposals: [], retrieval: {} } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('add a task') })
    await act(async () => { await ctx.current.sendMessage('chemistry') })
    const body = JSON.parse(streamMock.mock.calls.at(-1)[1].body)
    expect(body.history.at(-1)).toEqual({ role: 'assistant', text: 'Which class?' })
    expect(body.message).toBe('chemistry')
  })

  it('shows each lookup the assistant runs for itself', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'step', data: { tool: 'agenda', label: 'Read the calendar from 2026-09-01 to 2026-09-07' } },
      { event: 'step', data: { tool: 'workload', label: 'Checked the workload rules (2 finding(s))' } },
      { event: 'delta', data: { text: 'Thursday is your heaviest day.' } },
      { event: 'final', data: {
        answer: 'Thursday is your heaviest day.', citations: [], proposals: [], retrieval: {},
      } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('how is my week?') })
    const last = ctx.current.messages.at(-1)
    expect(last.steps.map(step => step.tool)).toEqual(['agenda', 'workload'])
    expect(last.text).toBe('Thursday is your heaviest day.')
  })

  it('drops text streamed before a lookup, because that round was superseded', async () => {
    // The model may start writing and then decide it needs to look something
    // up. Leaving the abandoned half-sentence above the real answer reads as
    // the assistant contradicting itself.
    streamMock.mockImplementation(scripted([
      { event: 'delta', data: { text: 'Let me check' } },
      { event: 'step', data: { tool: 'find', label: 'Looked through open tasks (3 found)' } },
      { event: 'delta', data: { text: 'You have three open tasks.' } },
      { event: 'final', data: {
        answer: 'You have three open tasks.', citations: [], proposals: [], retrieval: {},
      } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('how many tasks?') })
    const last = ctx.current.messages.at(-1)
    expect(last.text).toBe('You have three open tasks.')
    expect(last.text).not.toContain('Let me check')
  })

  it('brings the conversation back after a reload', async () => {
    // Losing the thread on refresh meant a clarifying question could never be
    // answered, and a long run of changes could not be picked back up.
    streamMock.mockImplementation(scripted([
      { event: 'final', data: { answer: 'Which class?', citations: [], proposals: [], retrieval: {} } },
    ]))
    const first = renderAi()
    await act(async () => { await ctx.current.sendMessage('add a task') })
    expect(store.value.map(m => m.text)).toContain('add a task')

    first.unmount()
    renderAi()
    await act(async () => {})
    expect(ctx.current.messages.map(m => m.text)).toContain('add a task')
    expect(ctx.current.messages.map(m => m.text)).toContain('Which class?')
  })

  it('does not let a slow restore wipe a message already sent', async () => {
    // The store is read asynchronously. A restore landing after the student has
    // typed would otherwise replace what they just sent.
    const { getSecureItem } = await import('../security/cryptoStore')
    let release
    getSecureItem.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    streamMock.mockImplementation(scripted([
      { event: 'final', data: { answer: 'Sure.', citations: [], proposals: [], retrieval: {} } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('urgent question') })
    await act(async () => { release([{ id: 'stale', role: 'user', text: 'an older thread' }]) })

    const texts = ctx.current.messages.map(m => m.text)
    expect(texts).toContain('urgent question')
    expect(texts).not.toContain('an older thread')
  })

  it('forgets the conversation when it is cleared', async () => {
    streamMock.mockImplementation(scripted([
      { event: 'final', data: { answer: 'Done.', citations: [], proposals: [], retrieval: {} } },
    ]))
    renderAi()
    await act(async () => { await ctx.current.sendMessage('something') })
    expect(store.value).not.toBeNull()
    await act(async () => { ctx.current.clearChat() })
    expect(store.value).toBeNull()
  })

  it('confirms every pending change from one press', async () => {
    const { apiFetch } = await import('../api/client')
    apiFetch.mockClear()
    apiFetch.mockImplementation(async () => ({ proposal_id: 'x', status: 'confirmed' }))
    renderAi()
    const proposals = [
      { proposal_id: 'a', status: 'pending', base_revision: 1 },
      { proposal_id: 'b', status: 'pending', base_revision: 2 },
      { proposal_id: 'c', status: 'confirmed', base_revision: 3 },
    ]
    await act(async () => { await ctx.current.confirmProposals(proposals) })
    const confirmed = apiFetch.mock.calls.filter(call => call[0].includes('/confirm'))
    expect(confirmed).toHaveLength(2)
    expect(confirmed[0][0]).toContain('/v1/proposals/a/confirm')
    expect(confirmed[1][0]).toContain('/v1/proposals/b/confirm')
  })
})
