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

