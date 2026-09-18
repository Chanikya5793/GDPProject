import { auth, firebaseConfigured, persistenceReady } from '../lib/firebase'

const API_URL = (import.meta.env.VITE_PLANNER_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function apiConfigured() {
  return firebaseConfigured && Boolean(API_URL)
}

// A request that never answers used to leave the page on its spinner for
// good: nothing aborted it. Generous, because the planner API is small and a
// slow link is the case this is for; the streaming route has its own below.
const REQUEST_TIMEOUT_MS = 30_000
const STREAM_TIMEOUT_MS = 180_000

function timeoutSignal(ms, override) {
  if (override) return override
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

// A validation failure arrives as a list of {loc, msg} entries, and a list
// interpolated into a message reads as "[object Object]". Name the first
// field and what was wrong with it; that is what the student can act on.
function describe(detail, status) {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0]
    const where = (first.loc || []).filter(part => part !== 'body' && typeof part === 'string').join('.')
    const message = first.msg || 'is invalid'
    const rest = detail.length > 1 ? ` (and ${detail.length - 1} more)` : ''
    return where ? `${where}: ${message}${rest}` : `${message}${rest}`
  }
  if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message
  return `Planner request failed (${status})`
}

/**
 * Read the sign-up policy without a token.
 *
 * apiFetch cannot serve this: it demands a signed-in user, and the whole point
 * is to check the address before an account exists.
 */
export async function fetchSignupPolicy() {
  if (!apiConfigured()) return null
  const response = await fetch(`${API_URL}/v1/signup-policy`, {
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new ApiError('Could not read the sign-up policy.', response.status)
  return response.json()
}

/**
 * Refuse before any request when the build cannot reach a planner API.
 *
 * Two different situations, deliberately told apart. No Firebase at all is
 * the public demo, and every store falls back to the device. Firebase but no
 * API URL is a broken deployment: with the same `not_configured` code it
 * looked like a working app whose every write quietly went nowhere.
 */
function assertConfigured() {
  if (!firebaseConfigured) {
    throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured')
  }
  if (!API_URL) {
    throw new ApiError('This build has no planner API URL. Set VITE_PLANNER_API_URL.', 503, 'misconfigured')
  }
}

function describeFailure(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new ApiError('The planner service took too long to answer. Please try again.', 0, 'timeout')
  }
  return error
}

export async function apiFetch(path, options = {}) {
  await persistenceReady
  assertConfigured()
  const user = auth?.currentUser
  if (!user) throw new ApiError('Sign in is required.', 401, 'unauthenticated')
  const token = await user.getIdToken()
  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: timeoutSignal(REQUEST_TIMEOUT_MS, options.signal),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    throw describeFailure(error)
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(describe(payload.detail, response.status), response.status, payload.code, payload)
  }
  return payload
}

export function idempotencyKey(prefix = 'web') {
  return `${prefix}-${crypto.randomUUID()}`
}


function parseSseBlock(block) {
  let name = 'message'
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  if (!data.length) return null
  try {
    return { event: name, data: JSON.parse(data.join('\n')) }
  } catch {
    // A malformed frame is not worth failing the whole answer over.
    return null
  }
}

/**
 * POST to a Server-Sent Events endpoint, calling onEvent for each event.
 *
 * apiFetch cannot serve this: it awaits the entire body before returning,
 * which is exactly the wait streaming exists to remove. Errors raised before
 * the body starts still arrive as ordinary status codes, so the caller can
 * keep treating 403 and 429 the way it always has.
 */
export async function apiStream(path, options = {}, onEvent) {
  await persistenceReady
  assertConfigured()
  const user = auth?.currentUser
  if (!user) throw new ApiError('Sign in is required.', 401, 'unauthenticated')
  const token = await user.getIdToken()
  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: timeoutSignal(STREAM_TIMEOUT_MS, options.signal),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    throw describeFailure(error)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(describe(payload.detail, response.status), response.status, payload.code, payload)
  }
  if (!response.body?.getReader) {
    throw new ApiError('This browser cannot stream responses.', 500, 'no_stream')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Events are separated by a blank line. Whatever follows the last blank
    // line is a partial frame and has to stay buffered until the rest lands.
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.trim()) continue
      const parsed = parseSseBlock(block)
      if (parsed) onEvent(parsed)
    }
  }
  const trailing = buffer.trim() ? parseSseBlock(buffer) : null
  if (trailing) onEvent(trailing)
}
