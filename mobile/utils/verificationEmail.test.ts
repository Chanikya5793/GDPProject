import { describe, expect, it, vi } from 'vitest'
import { createVerificationSender, verificationMessage } from './verificationEmail'

describe('verification requests', () => {
  it('coalesces concurrent requests for the same recipient', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const request = createVerificationSender(send)
    const user = { uid: 'a', email: 'a@example.test' }
    const a = request(user)
    const b = request(user)
    expect(a).toBe(b)
    expect(await a).toEqual(expect.any(Number))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps accounts and changed addresses separate', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const request = createVerificationSender(send)
    await Promise.all([
      request({ uid: 'a', email: 'a@example.test' }),
      request({ uid: 'b', email: 'b@example.test' }),
      request({ uid: 'a', email: 'changed@example.test' }),
    ])
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('surfaces rejection and permits an explicit retry without automatic sends', async () => {
    const failure = { code: 'auth/network-request-failed' }
    const send = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const request = createVerificationSender(send)
    const user = { uid: 'a', email: 'a@example.test' }
    await expect(request(user)).rejects.toEqual(failure)
    expect(send).toHaveBeenCalledTimes(1)
    await expect(request(user)).resolves.toEqual(expect.any(Number))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['auth/too-many-requests', 'This does not confirm delivery'],
    ['auth/quota-exceeded', 'sending limit'],
    ['auth/network-request-failed', 'connection'],
    ['auth/user-token-expired', 'Sign out'],
    ['auth/invalid-user-token', 'Sign out'],
  ])('explains %s without claiming the email arrived', (code, expected) => {
    expect(verificationMessage({ code })).toContain(expected)
  })

  it('never exposes raw provider details in the fallback', () => {
    expect(verificationMessage({ message: 'secret internal detail' })).not.toContain('secret')
    expect(verificationMessage(null)).toContain('Try Resend')
  })
})
