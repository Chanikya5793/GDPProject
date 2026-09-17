import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'token' } },
  firebaseConfigured: true,
  persistenceReady: Promise.resolve(),
}))

import { apiFetch } from './client'

function respond(status, body) {
  return { ok: status < 400, status, json: async () => body }
}

describe('apiFetch error messages', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PLANNER_API_URL', 'https://api.example.test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('names the field a validation error is about instead of [object Object]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(422, {
      detail: [
        { loc: ['body', 'items', 5, 'content', 'note', 'title'], msg: 'String should have at least 1 character' },
        { loc: ['body', 'items', 9, 'content', 'task', 'due_time'], msg: 'String should match pattern' },
      ],
    })))
    await expect(apiFetch('/v1/anything')).rejects.toThrow(
      'items.content.note.title: String should have at least 1 character (and 1 more)',
    )
  })

  it('passes a plain detail string through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(403, { detail: 'This planner is limited to @nwmissouri.edu accounts.' })))
    await expect(apiFetch('/v1/anything')).rejects.toThrow('limited to @nwmissouri.edu')
  })

  it('falls back to the status when there is no detail at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(502, {})))
    await expect(apiFetch('/v1/anything')).rejects.toThrow('Planner request failed (502)')
  })
})
