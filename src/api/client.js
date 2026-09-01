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

/**
 * Read the sign-up policy without a token.
 *
 * apiFetch cannot serve this: it demands a signed-in user, and the whole point
 * is to check the address before an account exists.
 */
export async function fetchSignupPolicy() {
  if (!apiConfigured()) return null
  const response = await fetch(`${API_URL}/v1/signup-policy`)
  if (!response.ok) throw new ApiError('Could not read the sign-up policy.', response.status)
  return response.json()
}

export async function apiFetch(path, options = {}) {
  await persistenceReady
  if (!apiConfigured()) {
    throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured')
  }
  const user = auth?.currentUser
  if (!user) throw new ApiError('Sign in is required.', 401, 'unauthenticated')
  const token = await user.getIdToken()
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      payload.detail || `Planner request failed (${response.status})`,
      response.status,
      payload.code,
      payload,
    )
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
  if (!apiConfigured()) {
    throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured')
  }
  const user = auth?.currentUser
  if (!user) throw new ApiError('Sign in is required.', 401, 'unauthenticated')
  const token = await user.getIdToken()
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(
      payload.detail || `Planner request failed (${response.status})`,
      response.status,
      payload.code,
      payload,
    )
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
