import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { base64 } from '@scure/base';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const VERSION = 'nw_secure_v1';
const SENSITIVE_KEYS = [
  'nw_tasks', 'nw_reminders', 'nw_notes', 'nw_tags', 'nw_categories', 'nw_trash', 'nw_settings',
];
let authenticatedUid: string | null = null;
const scopeListeners = new Set<() => void>();

export function getStorageUid(): string | null { return authenticatedUid; }

export function setStorageUid(uid: string | null): void {
  if (authenticatedUid === uid) return;
  authenticatedUid = uid;
  // Anything already loaded was read from the previous scope and is now stale.
  for (const listener of scopeListeners) listener();
}

/**
 * Subscribe to scope changes, returning an unsubscribe function.
 *
 * Providers that read at mount can sit above the auth provider, in which case
 * their first read happens against the pre-sign-in scope and finds nothing.
 * Without this they would keep serving that empty read for the whole session
 * while their writes went to the signed-in user's scope.
 */
export function onStorageScopeChange(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => { scopeListeners.delete(listener); };
}

function scope(): string {
  return authenticatedUid || 'device-settings';
}

function storageKey(key: string, userScope = scope()): string {
  return `${VERSION}:${userScope}:${key}`;
}

function keyId(userScope: string): string {
  return `planner_key_${userScope.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}

// One in-flight lookup per scope. The first writes for a new account arrive
// together -- the notification prompt flag and the first outbox write land in
// the same tick -- and each used to find no key, generate its own and store
// it; the last write won, and whatever the other had encrypted could never be
// read again. About half of fresh installs landed on the losing order.
const deviceKeys = new Map<string, Promise<Uint8Array>>();

function getDeviceKey(userScope: string): Promise<Uint8Array> {
  let pending = deviceKeys.get(userScope);
  if (!pending) {
    pending = loadOrCreateDeviceKey(userScope).catch(error => {
      deviceKeys.delete(userScope);
      throw error;
    });
    deviceKeys.set(userScope, pending);
  }
  return pending;
}

async function loadOrCreateDeviceKey(userScope: string): Promise<Uint8Array> {
  const id = keyId(userScope);
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const existing = await SecureStore.getItemAsync(id, options);
  if (existing) return base64.decode(existing);
  const generated = await Crypto.getRandomBytesAsync(32);
  await SecureStore.setItemAsync(id, base64.encode(generated), options);
  // Re-read rather than trust our write: if anything else stored a key in
  // the meantime, the one in the keychain is the one every write must use.
  const stored = await SecureStore.getItemAsync(id, options);
  return stored ? base64.decode(stored) : generated;
}

// One writer at a time per (scope, key). Every collection here is stored as
// a whole -- read, change, write back -- so two changes in flight at once
// used to keep only whichever wrote last.
const locks = new Map<string, Promise<void>>();

export function withStorageLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const lockKey = storageKey(key);
  const previous = locks.get(lockKey) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  locks.set(lockKey, settled);
  void settled.then(() => { if (locks.get(lockKey) === settled) locks.delete(lockKey); });
  return run;
}

function aad(key: string, userScope: string): Uint8Array {
  return new TextEncoder().encode(`northwest-planner:mobile:v1:${userScope}:${key}`);
}

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  const userScope = scope();
  const storedKey = storageKey(key, userScope);
  const raw = await AsyncStorage.getItem(storedKey);
  if (!raw) return fallback;
  let envelope: { algorithm: string; nonce: string; ciphertext: string };
  try {
    envelope = JSON.parse(raw);
  } catch {
    // Not one of ours any more. Leaving it in place made every read of this
    // key throw, which left the planner empty with no way to recover short
    // of deleting the app.
    await AsyncStorage.removeItem(storedKey);
    return fallback;
  }
  if (envelope.algorithm !== 'XCHACHA20-POLY1305') throw new Error('Unsupported secure storage format');
  try {
    const cipher = xchacha20poly1305(
      await getDeviceKey(userScope), base64.decode(envelope.nonce), aad(key, userScope),
    );
    const plaintext = cipher.decrypt(base64.decode(envelope.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // The key this was written under is gone: the keychain entry does not
    // migrate to a new phone (THIS_DEVICE_ONLY) while AsyncStorage does, or
    // the old key race lost it. Nothing can ever read it again; drop it so
    // the app comes back. The server still holds the records.
    console.warn(`Discarding unreadable offline cache for ${key}`);
    await AsyncStorage.removeItem(storedKey);
    return fallback;
  }
}

/**
 * Read, change and write back one stored value with no other writer between.
 *
 * `updater` receives the current value (or `fallback`) and returns the value
 * to store; returning `undefined` leaves the store untouched.
 */
export function updateItem<T>(key: string, fallback: T, updater: (current: T) => T | undefined | Promise<T | undefined>): Promise<T> {
  return withStorageLock(key, async () => {
    const current = await getItem<T>(key, fallback);
    const next = await updater(current);
    if (next !== undefined) await setItem(key, next);
    return next === undefined ? current : next;
  });
}

export async function setItem(key: string, value: unknown): Promise<void> {
  const userScope = scope();
  const nonce = await Crypto.getRandomBytesAsync(24);
  const cipher = xchacha20poly1305(await getDeviceKey(userScope), nonce, aad(key, userScope));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  await AsyncStorage.setItem(storageKey(key, userScope), JSON.stringify({
    algorithm: 'XCHACHA20-POLY1305',
    nonce: base64.encode(nonce),
    ciphertext: base64.encode(cipher.encrypt(plaintext)),
  }));
}

export async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(key));
}

export async function migrateLegacyStorage(uid: string): Promise<number> {
  setStorageUid(uid);
  let migrated = 0;
  for (const key of SENSITIVE_KEYS) {
    const plaintext = await AsyncStorage.getItem(key);
    if (!plaintext) continue;
    let value: unknown;
    try { value = JSON.parse(plaintext); } catch { value = plaintext; }
    await setItem(key, value);
    await AsyncStorage.removeItem(key);
    migrated += 1;
  }
  return migrated;
}
