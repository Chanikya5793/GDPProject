// Demo-mode sign-in for builds with no Firebase project configured.
//
// Mirrors the web app's fallback (src/context/AuthContext.jsx): without it the
// Expo app cannot get past its login screen at all, since login() has nothing to
// authenticate against. Every caller is gated on `!firebaseConfigured`, so a
// build with real credentials never reaches this.
//
// Pure helpers live here rather than in the context so they can be unit tested
// without a React Native test harness.

import { User } from '@/types';

/** Device-scoped, so it is readable before a uid has been established. */
export const DEMO_USER_KEY = 'nw_demo_user';

/**
 * A stable id derived from the email.
 *
 * This is what setStorageUid() namespaces every planner record under, so it has
 * to survive sign-out: a user returning with the same email must land back on
 * their own data rather than an empty planner.
 */
export function demoUid(email: string): string {
  const slug = String(email || 'guest')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    // Trim the separators too: an address of only punctuation collapses to "_",
    // which is truthy, so without this every such user would share one scope.
    .replace(/^_+|_+$/g, '');
  return `demo_${slug || 'guest'}`;
}

export function makeDemoUser(name: string | null | undefined, email: string): User {
  const address = String(email || '').trim();
  const uid = demoUid(address);
  return {
    id: uid,
    uid,
    name: name?.trim() || address.split('@')[0] || 'Planner user',
    email: address,
    emailVerified: true,
  };
}

/**
 * Validates a persisted demo session. Returns null for anything unusable so a
 * corrupted record signs the user out instead of crashing the app on launch.
 */
export function parseStoredDemoUser(value: unknown): User | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<User>;
  if (typeof candidate.email !== 'string' || !candidate.email) return null;
  // Rebuild rather than trust the stored uid, so a record written by an older
  // build still lands on the uid the current scheme would produce.
  return makeDemoUser(candidate.name, candidate.email);
}
