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
})
