import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'test-token' } },
  firebaseConfigured: true,
  persistenceReady: Promise.resolve(),
}))

vi.stubEnv('VITE_PLANNER_API_URL', 'https://planner.test')

const { apiStream } = await import('./client')

const encoder = new TextEncoder()

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function respondWith(chunks, init = {}) {
  return vi.fn(async () => new Response(streamOf(chunks), {
    status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init,
  }))
}

async function collect(chunks) {
  globalThis.fetch = respondWith(chunks)
  const events = []
  await apiStream('/v1/copilot/chat/stream', { method: 'POST' }, e => events.push(e))
  return events
}

describe('apiStream', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('parses events split across arbitrary chunk boundaries', async () => {
    // The network decides where the bytes break; a frame split mid-word must
    // not produce two half events.
    const body = 'event: delta\ndata: {"text":"Start "}\n\nevent: delta\ndata: {"text":"here."}\n\nevent: final\ndata: {"answer":"Start here."}\n\n'
    const chunks = []
    for (let i = 0; i < body.length; i += 7) chunks.push(body.slice(i, i + 7))
    const events = await collect(chunks)
    expect(events.map(e => e.event)).toEqual(['delta', 'delta', 'final'])
    expect(events[0].data.text).toBe('Start ')
    expect(events[2].data.answer).toBe('Start here.')
  })

  it('handles a multi-byte character split across two chunks', async () => {
    // TextDecoder with stream:true is what keeps a half emoji from becoming a
    // replacement character.
    const payload = encoder.encode('event: delta\ndata: {"text":"hi \u{1F600}"}\n\n')
    const cut = payload.length - 6
    globalThis.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(payload.slice(0, cut))
          controller.enqueue(payload.slice(cut))
          controller.close()
        },
      }),
      { status: 200 },
    ))
    const events = []
    await apiStream('/x', { method: 'POST' }, e => events.push(e))
    expect(events[0].data.text).toBe('hi \u{1F600}')
  })

  it('accepts CRLF line endings', async () => {
    const events = await collect(['event: final\r\ndata: {"answer":"ok"}\r\n\r\n'])
    expect(events).toEqual([{ event: 'final', data: { answer: 'ok' } }])
  })

  it('skips malformed frames instead of failing the answer', async () => {
    const events = await collect([
      'event: delta\ndata: not json\n\nevent: delta\ndata: {"text":"fine"}\n\n',
    ])
    expect(events).toHaveLength(1)
    expect(events[0].data.text).toBe('fine')
  })

  it('delivers a trailing frame that has no blank line after it', async () => {
    const events = await collect(['event: final\ndata: {"answer":"done"}'])
    expect(events).toEqual([{ event: 'final', data: { answer: 'done' } }])
  })

  it('throws a typed ApiError for a pre-stream failure so status codes still work', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Rate limit exceeded. Retry in 152 seconds.', code: 'rate_limited' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ))
    await expect(apiStream('/x', { method: 'POST' }, () => {})).rejects.toMatchObject({
      status: 429, code: 'rate_limited',
    })
  })
})
