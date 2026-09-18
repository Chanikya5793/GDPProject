const DB_NAME = 'northwest-planner-secure-keys'
const DB_VERSION = 1
const STORE_NAME = 'deviceKeys'
const STORAGE_PREFIX = 'nw_secure_v1'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionRequest(mode, callback) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = callback(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  }))
}

// One in-flight lookup per uid. The first writes for a new user arrive
// together -- the dashboard loads tasks, reminders and notes at once -- and
// each used to find no key, generate its own and store it; the last put won,
// and everything encrypted under the other keys could never be read again.
const deviceKeys = new Map()

function getDeviceKey(uid) {
  let pending = deviceKeys.get(uid)
  if (!pending) {
    pending = loadOrCreateDeviceKey(uid).catch(error => {
      deviceKeys.delete(uid)
      throw error
    })
    deviceKeys.set(uid, pending)
  }
  return pending
}

async function loadOrCreateDeviceKey(uid) {
  const keyId = `planner-device-key:${uid}`
  const existing = await transactionRequest('readonly', store => store.get(keyId))
  if (existing) return existing
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  // `add` rather than `put`: if another tab stored a key in the meantime this
  // fails, and the one already there is the one every write must use.
  try {
    await transactionRequest('readwrite', store => store.add(key, keyId))
    return key
  } catch {
    const stored = await transactionRequest('readonly', store => store.get(keyId))
    if (stored) return stored
    throw new Error('Could not store the device encryption key')
  }
}

// One writer at a time per (uid, namespace). Every collection here is stored
// as a whole -- read, change, write back -- so two changes in flight at once
// used to keep only whichever wrote last.
const locks = new Map()

export function withSecureLock(uid, namespace, task) {
  const key = storageKey(uid, namespace)
  const previous = locks.get(key) || Promise.resolve()
  const run = previous.then(task, task)
  const settled = run.then(() => undefined, () => undefined)
  locks.set(key, settled)
  settled.then(() => { if (locks.get(key) === settled) locks.delete(key) })
  return run
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function storageKey(uid, namespace) {
  return `${STORAGE_PREFIX}:${uid}:${namespace}`
}

function additionalData(uid, namespace) {
  return new TextEncoder().encode(`northwest-planner:v1:${uid}:${namespace}`)
}

export async function setSecureItem(uid, namespace, value) {
  const key = await getDeviceKey(uid)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(uid, namespace) },
    key,
    plaintext,
  )
  localStorage.setItem(storageKey(uid, namespace), JSON.stringify({
    algorithm: 'AES-256-GCM',
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  }))
}

export async function getSecureItem(uid, namespace, fallback) {
  const raw = localStorage.getItem(storageKey(uid, namespace))
  if (!raw) return fallback
  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch {
    // Not one of ours any more. Leaving it in place made every read of this
    // namespace throw, which took the whole page down until the student
    // cleared site data by hand.
    localStorage.removeItem(storageKey(uid, namespace))
    return fallback
  }
  if (envelope.algorithm !== 'AES-256-GCM') throw new Error('Unsupported local encryption format')
  const key = await getDeviceKey(uid)
  let plaintext
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.nonce),
        additionalData: additionalData(uid, namespace),
      },
      key,
      base64ToBytes(envelope.ciphertext),
    )
  } catch {
    // The key this was written under is gone (site data partially cleared,
    // or the old key race). Nothing can ever read it again; drop it so the
    // app comes back rather than failing on every load. In a configured
    // build the server still holds the records.
    console.warn(`Discarding unreadable offline cache for ${namespace}`)
    localStorage.removeItem(storageKey(uid, namespace))
    return fallback
  }
  return JSON.parse(new TextDecoder().decode(plaintext))
}

/**
 * Read, change and write back one collection with no other writer between.
 *
 * `updater` receives the current value (or `fallback`) and returns the value
 * to store; returning `undefined` leaves the store untouched.
 */
export function updateSecureItem(uid, namespace, fallback, updater) {
  return withSecureLock(uid, namespace, async () => {
    const current = await getSecureItem(uid, namespace, fallback)
    const next = await updater(current)
    if (next !== undefined) await setSecureItem(uid, namespace, next)
    return next === undefined ? current : next
  })
}

export function removeSecureItem(uid, namespace) {
  localStorage.removeItem(storageKey(uid, namespace))
}

export function secureStorageKey(uid, namespace) {
  return storageKey(uid, namespace)
}

