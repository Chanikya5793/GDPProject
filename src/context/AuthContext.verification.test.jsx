import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  auth: { currentUser: null }, listener: null,
  send: vi.fn(), reload: vi.fn(), create: vi.fn(), update: vi.fn(),
}))
vi.mock('../lib/firebase', () => ({ auth: mock.auth, firebaseConfigured: true, persistenceReady: Promise.resolve() }))
vi.mock('../api/client', () => ({ fetchSignupPolicy: vi.fn().mockResolvedValue({ enforce: false }) }))
vi.mock('firebase/auth', () => ({
  sendEmailVerification: mock.send, reload: mock.reload,
  createUserWithEmailAndPassword: mock.create, updateProfile: mock.update,
  onAuthStateChanged: vi.fn((auth, callback) => { mock.listener = callback; callback(auth.currentUser); return () => {} }),
  applyActionCode: vi.fn(), signInWithEmailAndPassword: vi.fn(), signOut: vi.fn(), verifyBeforeUpdateEmail: vi.fn(),
}))
import { AuthProvider, useAuth } from './AuthContext'
import VerifyEmailBanner from '../components/VerifyEmailBanner'
const ctx = { current: null }
function Probe() { ctx.current = useAuth(); return <VerifyEmailBanner /> }
const recipient = (uid = 'a') => ({ uid, email: `${uid}@example.test`, emailVerified: false, getIdToken: vi.fn().mockResolvedValue('token') })
const mount = async () => { render(<AuthProvider><Probe /></AuthProvider>); await waitFor(() => expect(ctx.current.loading).toBe(false)) }

describe('configured verification flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.auth.currentUser = null
    mock.send.mockResolvedValue(undefined)
    mock.reload.mockResolvedValue(undefined)
    mock.update.mockResolvedValue(undefined)
    mock.create.mockImplementation(async () => { mock.auth.currentUser = recipient(); return { user: mock.auth.currentUser } })
  })

  it('keeps the created account and exposes a failed signup send on the next screen', async () => {
    mock.send.mockRejectedValue({ code: 'auth/network-request-failed' })
    await mount()
    let result
    await act(async () => { result = await ctx.current.register('A', 'a@example.test', 'password') })
    expect(result.success).toBe(true)
    expect(ctx.current.user.uid).toBe('a')
    expect(ctx.current.verificationSentAt).toBeNull()
    expect(screen.getByText(/Could not reach the email service/)).toBeInTheDocument()
    expect(screen.queryByText(/We sent a link/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled()
  })

  it('starts the cooldown only on provider acceptance and clears a previous error on retry', async () => {
    mock.auth.currentUser = recipient()
    await mount()
    mock.send.mockRejectedValueOnce({ code: 'auth/quota-exceeded' })
    await act(async () => { await expect(ctx.current.resendVerification()).rejects.toBeDefined() })
    expect(ctx.current.verificationSentAt).toBeNull()
    expect(ctx.current.verificationError).toContain('sending limit')
    await act(async () => { await ctx.current.resendVerification() })
    expect(ctx.current.verificationSentAt).toEqual(expect.any(Number))
    expect(ctx.current.verificationError).toBeNull()
    expect(screen.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  })

  it('does not give a different account the previous recipient cooldown', async () => {
    mock.auth.currentUser = recipient()
    await mount()
    await act(async () => { await ctx.current.resendVerification() })
    await act(async () => { mock.auth.currentUser = recipient('b'); mock.listener(mock.auth.currentUser) })
    expect(ctx.current.verificationSentAt).toBeNull()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled()
  })

  it('keeps the new recipient status when a previous send finishes late', async () => {
    mock.auth.currentUser = recipient()
    await mount()
    let finish
    mock.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let pending
    await act(async () => { pending = ctx.current.resendVerification(); await Promise.resolve() })
    await act(async () => { mock.auth.currentUser = recipient('b'); mock.listener(mock.auth.currentUser) })
    await act(async () => { await ctx.current.resendVerification() })
    const sentAt = ctx.current.verificationSentAt
    await act(async () => { finish(); await pending })
    expect(ctx.current.verificationSentAt).toBe(sentAt)
    expect(JSON.parse(sessionStorage.getItem('nw_verification_status')).uid).toBe('b')
  })

  it.each(['focus', 'visibilitychange'])('checks after a one-hour wait on %s', async event => {
    mock.auth.currentUser = recipient()
    await mount()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60_000)
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    try {
      await act(async () => { (event === 'focus' ? window : document).dispatchEvent(new Event(event)) })
      expect(mock.reload).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
      visible.mockRestore()
    }
  })

  it('coalesces overlapping foreground verification checks', async () => {
    mock.auth.currentUser = recipient()
    await mount()
    let finish
    mock.reload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    try {
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(mock.reload).toHaveBeenCalledTimes(1)
      await act(async () => { finish() })
    } finally { visible.mockRestore() }
  })

  it('refreshes a stale ID token even when the restored profile already says verified', async () => {
    mock.auth.currentUser = { ...recipient(), emailVerified: true }
    await mount()
    await act(async () => { await ctx.current.refreshUser() })
    expect(mock.auth.currentUser.getIdToken).toHaveBeenCalledWith(true)
  })

  it('does not publish an old account after a verification check races with sign-in', async () => {
    const old = recipient()
    mock.auth.currentUser = old
    await mount()
    mock.reload.mockImplementation(async () => { mock.auth.currentUser = recipient('b'); mock.listener(mock.auth.currentUser) })
    let result
    await act(async () => { result = await ctx.current.refreshUser() })
    expect(result).toBeNull()
    expect(ctx.current.user.uid).toBe('b')
    expect(old.getIdToken).not.toHaveBeenCalled()
  })
})
