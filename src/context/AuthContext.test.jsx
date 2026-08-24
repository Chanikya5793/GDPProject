import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Pages build ships without Firebase env vars, so firebaseConfigured is
// false there. These tests pin the demo fallback that keeps that build usable.
vi.mock('../lib/firebase', () => ({
  auth: null,
  firebaseConfigured: false,
  persistenceReady: Promise.resolve(),
}))

import { AuthProvider, useAuth } from './AuthContext'

// A mutable holder rather than an outer `let`, which the lint config forbids
// reassigning from inside a component.
const ctx = { current: null }
function Probe() {
  ctx.current = useAuth()
  const { user } = ctx.current
  return <span>{user ? `${user.name}|${user.uid}` : 'signed-out'}</span>
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>)

describe('AuthContext demo fallback (no Firebase configured)', () => {
  beforeEach(() => { ctx.current = null })

  it('signs in without Firebase and exposes a uid for the planner cache', async () => {
    renderAuth()
    expect(screen.getByText('signed-out')).toBeInTheDocument()

    let result
    await act(async () => { result = await ctx.current.login('Bobby@Example.com ', 'pw') })

    expect(result).toEqual({ success: true })
    expect(ctx.current.user.uid).toBe('demo_bobby_example_com')
    // plannerStore.currentUid() reads this key; without it every CRUD call throws.
    expect(sessionStorage.getItem('nw_authenticated_uid')).toBe('demo_bobby_example_com')
  })

  it('rejects an empty email instead of creating a uid-less session', async () => {
    renderAuth()
    let result
    await act(async () => { result = await ctx.current.login('   ', 'pw') })
    expect(result.success).toBe(false)
    expect(sessionStorage.getItem('nw_authenticated_uid')).toBeNull()
  })

  it('restores a saved demo session on mount', async () => {
    localStorage.setItem('nw_user', JSON.stringify({
      id: 'demo_ada_example_com', uid: 'demo_ada_example_com',
      name: 'Ada', email: 'ada@example.com',
    }))
    await act(async () => { renderAuth() })
    expect(screen.getByText('Ada|demo_ada_example_com')).toBeInTheDocument()
    expect(sessionStorage.getItem('nw_authenticated_uid')).toBe('demo_ada_example_com')
  })

  it('upgrades a pre-existing session that has no uid', async () => {
    // Sessions written by the previous localStorage-only build look like this.
    localStorage.setItem('nw_user', JSON.stringify({
      id: 1, name: 'Bobby Bearcat', email: 'bobby@example.com',
    }))
    await act(async () => { renderAuth() })
    expect(ctx.current.user.uid).toBe('demo_bobby_example_com')
    expect(sessionStorage.getItem('nw_authenticated_uid')).toBe('demo_bobby_example_com')
  })

  it('keeps the uid stable across a rename so cached records stay reachable', async () => {
    renderAuth()
    await act(async () => { await ctx.current.register('Ada', 'ada@example.com', 'pw') })
    const original = ctx.current.user.uid

    await act(async () => { await ctx.current.updateUser({ name: 'Ada Lovelace' }) })

    expect(ctx.current.user.name).toBe('Ada Lovelace')
    expect(ctx.current.user.uid).toBe(original)
    expect(JSON.parse(localStorage.getItem('nw_user')).name).toBe('Ada Lovelace')
  })

  it('clears both stores on logout', async () => {
    renderAuth()
    await act(async () => { await ctx.current.login('ada@example.com', 'pw') })
    await act(async () => { await ctx.current.logout() })

    expect(ctx.current.user).toBeNull()
    expect(localStorage.getItem('nw_user')).toBeNull()
    expect(sessionStorage.getItem('nw_authenticated_uid')).toBeNull()
  })

  it('drops corrupted stored sessions instead of crashing the app', async () => {
    localStorage.setItem('nw_user', '{not json')
    await act(async () => { renderAuth() })
    expect(ctx.current.user).toBeNull()
    expect(localStorage.getItem('nw_user')).toBeNull()
  })
})
