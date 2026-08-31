import { describe, expect, it } from 'vitest'
import { getSecureItem, secureStorageKey, setSecureItem } from './cryptoStore'

describe('encrypted browser storage', () => {
  it('round trips encrypted values without plaintext in localStorage', async () => {
    await setSecureItem('alice', 'records:notes', [{ body: 'private exam notes' }])
    const raw = localStorage.getItem(secureStorageKey('alice', 'records:notes'))
    expect(raw).not.toContain('private exam notes')
    await expect(getSecureItem('alice', 'records:notes', [])).resolves.toEqual([
      { body: 'private exam notes' },
    ])
  })

  it('uses a different ciphertext and key scope for each user', async () => {
    await setSecureItem('alice', 'records:tasks', [{ title: 'same' }])
    await setSecureItem('bob', 'records:tasks', [{ title: 'same' }])
    expect(localStorage.getItem(secureStorageKey('alice', 'records:tasks')))
      .not.toBe(localStorage.getItem(secureStorageKey('bob', 'records:tasks')))
  })

  it('rejects tampered ciphertext', async () => {
    await setSecureItem('alice', 'records:notes', [{ body: 'secret' }])
    const key = secureStorageKey('alice', 'records:notes')
    const envelope = JSON.parse(localStorage.getItem(key))
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`
    localStorage.setItem(key, JSON.stringify(envelope))
    await expect(getSecureItem('alice', 'records:notes', [])).rejects.toThrow()
  })

  it('returns the supplied fallback when no encrypted value exists', async () => {
    await expect(getSecureItem('alice', 'missing', ['fallback'])).resolves.toEqual(['fallback'])
  })
})

