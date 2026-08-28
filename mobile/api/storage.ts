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

function storageKey(key: string): string {
  return `${VERSION}:${scope()}:${key}`;
}

function keyId(): string {
  return `planner_key_${scope().replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}

async function getDeviceKey(): Promise<Uint8Array> {
  const id = keyId();
  const existing = await SecureStore.getItemAsync(id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (existing) return base64.decode(existing);
  const generated = await Crypto.getRandomBytesAsync(32);
  await SecureStore.setItemAsync(id, base64.encode(generated), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

function aad(key: string): Uint8Array {
  return new TextEncoder().encode(`northwest-planner:mobile:v1:${scope()}:${key}`);
}

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(storageKey(key));
  if (!raw) return fallback;
  const envelope = JSON.parse(raw) as { algorithm: string; nonce: string; ciphertext: string };
  if (envelope.algorithm !== 'XCHACHA20-POLY1305') throw new Error('Unsupported secure storage format');
  const cipher = xchacha20poly1305(
    await getDeviceKey(), base64.decode(envelope.nonce), aad(key),
  );
  const plaintext = cipher.decrypt(base64.decode(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function setItem(key: string, value: unknown): Promise<void> {
  const nonce = await Crypto.getRandomBytesAsync(24);
  const cipher = xchacha20poly1305(await getDeviceKey(), nonce, aad(key));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  await AsyncStorage.setItem(storageKey(key), JSON.stringify({
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

