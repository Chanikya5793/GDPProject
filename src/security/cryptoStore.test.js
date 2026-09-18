import { describe, expect, it, vi } from 'vitest'
import { getSecureItem, secureStorageKey, setSecureItem, updateSecureItem } from './cryptoStore'

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

  it('never returns tampered ciphertext, and discards it so the app can recover', async () => {
    await setSecureItem('alice', 'records:notes', [{ body: 'secret' }])
    const key = secureStorageKey('alice', 'records:notes')
    const envelope = JSON.parse(localStorage.getItem(key))
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`
    localStorage.setItem(key, JSON.stringify(envelope))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(getSecureItem('alice', 'records:notes', ['fallback'])).resolves.toEqual(['fallback'])
    expect(localStorage.getItem(key)).toBeNull()
    warn.mockRestore()
  })

  it('discards an envelope that is not JSON rather than failing every read', async () => {
    localStorage.setItem(secureStorageKey('alice', 'records:notes'), '{not json')
    await expect(getSecureItem('alice', 'records:notes', [])).resolves.toEqual([])
  })

  it('shares one device key across concurrent first writes', async () => {
    const uid = `fresh-${crypto.randomUUID()}`
    await Promise.all([
      setSecureItem(uid, 'a', [1]),
      setSecureItem(uid, 'b', [2]),
      setSecureItem(uid, 'c', [3]),
    ])
    await expect(Promise.all([
      getSecureItem(uid, 'a', null),
      getSecureItem(uid, 'b', null),
      getSecureItem(uid, 'c', null),
    ])).resolves.toEqual([[1], [2], [3]])
  })

  it('serialises concurrent read-modify-write on one namespace', async () => {
    await setSecureItem('alice', 'counter', [])
    await Promise.all(Array.from({ length: 5 }, (_, index) =>
      updateSecureItem('alice', 'counter', [], items => [...items, index])
    ))
    await expect(getSecureItem('alice', 'counter', [])).resolves.toEqual([0, 1, 2, 3, 4])
  })

  it('leaves the store untouched when the updater returns undefined', async () => {
    await setSecureItem('alice', 'keep', ['as-is'])
    await expect(updateSecureItem('alice', 'keep', [], () => undefined)).resolves.toEqual(['as-is'])
    await expect(getSecureItem('alice', 'keep', [])).resolves.toEqual(['as-is'])
  })

  it('returns the supplied fallback when no encrypted value exists', async () => {
    await expect(getSecureItem('alice', 'missing', ['fallback'])).resolves.toEqual(['fallback'])
  })
})

