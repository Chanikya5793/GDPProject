import { describe, expect, it } from 'vitest';

import { demoUid, makeDemoUser, parseStoredDemoUser } from './demoAuth';

describe('demoUid', () => {
  it('is stable for the same address regardless of case or padding', () => {
    expect(demoUid('Bobby@Example.com ')).toBe('demo_bobby_example_com');
    expect(demoUid('bobby@example.com')).toBe(demoUid('  BOBBY@EXAMPLE.COM  '));
  });

  it('separates different users', () => {
    expect(demoUid('a@example.com')).not.toBe(demoUid('b@example.com'));
  });

  it('never produces a bare prefix for empty input', () => {
    // A uid of "demo_" would silently pool every empty-email session into one
    // storage scope.
    expect(demoUid('')).toBe('demo_guest');
    expect(demoUid('   ')).toBe('demo_guest');
    expect(demoUid('@@@')).toBe('demo_guest');
  });
});

describe('makeDemoUser', () => {
  it('uses the provided name when there is one', () => {
    expect(makeDemoUser('Ada Lovelace', 'ada@example.com').name).toBe('Ada Lovelace');
  });

  it('falls back to the local part of the email', () => {
    expect(makeDemoUser(null, 'bobbybearcat@nwmissouri.edu').name).toBe('bobbybearcat');
  });

  it('sets id and uid to the same stable value', () => {
    const user = makeDemoUser(null, 'ada@example.com');
    expect(user.uid).toBe('demo_ada_example_com');
    expect(user.id).toBe(user.uid);
  });

  it('trims the address it stores', () => {
    expect(makeDemoUser(null, '  ada@example.com ').email).toBe('ada@example.com');
  });
});

describe('parseStoredDemoUser', () => {
  it('restores a previously saved session', () => {
    const saved = makeDemoUser('Ada', 'ada@example.com');
    expect(parseStoredDemoUser(saved)).toEqual(saved);
  });

  it('rebuilds the uid rather than trusting the stored one', () => {
    // A record written by an older scheme must still resolve to the uid the
    // current scheme produces, or the user loses their planner data.
    const stale = { id: 1, uid: 'legacy-value', name: 'Ada', email: 'ada@example.com' };
    expect(parseStoredDemoUser(stale)?.uid).toBe('demo_ada_example_com');
  });

  it('rejects records with no usable email', () => {
    expect(parseStoredDemoUser({ name: 'Ada' })).toBeNull();
    expect(parseStoredDemoUser({ name: 'Ada', email: '' })).toBeNull();
    expect(parseStoredDemoUser({ email: 42 })).toBeNull();
  });

  it('rejects non-objects instead of throwing', () => {
    for (const value of [null, undefined, 'string', 7, []]) {
      expect(parseStoredDemoUser(value)).toBeNull();
    }
  });
});
