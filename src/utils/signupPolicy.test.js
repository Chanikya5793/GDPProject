import { describe, expect, it } from 'vitest'

import { normalizeEmail, refusalFor } from './signupPolicy'

const policy = {
  enforce: true,
  allowed_domains: ['nwmissouri.edu'],
  message: 'This planner is limited to @nwmissouri.edu accounts.',
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Student@NWMissouri.EDU ')).toBe('student@nwmissouri.edu')
  })

  it('survives null and undefined', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })
})

describe('refusalFor', () => {
  it('allows an address on an allowed domain', () => {
    expect(refusalFor('student@nwmissouri.edu', policy)).toBeNull()
  })

  it('is case and whitespace insensitive', () => {
    expect(refusalFor('  Student@NWMissouri.EDU  ', policy)).toBeNull()
  })

  it('refuses another domain with the server message', () => {
    expect(refusalFor('someone@gmail.com', policy)).toBe(policy.message)
  })

  it('does not accept a lookalike domain', () => {
    expect(refusalFor('a@evil-nwmissouri.edu', policy)).toBe(policy.message)
    expect(refusalFor('a@nwmissouri.edu.example.com', policy)).toBe(policy.message)
  })

  it('uses the last @ so a plus-addressed local part cannot smuggle a domain', () => {
    expect(refusalFor('a@b@nwmissouri.edu', policy)).toBeNull()
  })

  it('falls back to its own wording when the server sends no message', () => {
    const bare = { enforce: true, allowed_domains: ['nwmissouri.edu'] }
    expect(refusalFor('x@gmail.com', bare)).toContain('@nwmissouri.edu')
  })

  it('allows everything when enforcement is off', () => {
    expect(refusalFor('anyone@anywhere.com', { ...policy, enforce: false })).toBeNull()
  })

  it('allows everything when no domains are listed', () => {
    expect(refusalFor('anyone@anywhere.com', { ...policy, allowed_domains: [] })).toBeNull()
  })

  it('does not block when the policy could not be read', () => {
    // The server still enforces; a failed fetch must not lock out a real student.
    expect(refusalFor('someone@gmail.com', null)).toBeNull()
    expect(refusalFor('someone@gmail.com', undefined)).toBeNull()
  })

  it('leaves a malformed address to the form validation', () => {
    expect(refusalFor('not-an-email', policy)).toBeNull()
    expect(refusalFor('', policy)).toBeNull()
  })

  it('accepts any of several allowed domains', () => {
    const multi = { ...policy, allowed_domains: ['nwmissouri.edu', 'example.org'] }
    expect(refusalFor('a@example.org', multi)).toBeNull()
    expect(refusalFor('a@other.com', multi)).toBe(policy.message)
  })
})
