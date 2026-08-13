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

async function getDeviceKey(uid) {
  const keyId = `planner-device-key:${uid}`
  let key = await transactionRequest('readonly', store => store.get(keyId))
  if (key) return key
  key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  await transactionRequest('readwrite', store => store.put(key, keyId))
  return key
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
  const envelope = JSON.parse(raw)
  if (envelope.algorithm !== 'AES-256-GCM') throw new Error('Unsupported local encryption format')
  const key = await getDeviceKey(uid)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.nonce),
      additionalData: additionalData(uid, namespace),
    },
    key,
    base64ToBytes(envelope.ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext))
}

export function removeSecureItem(uid, namespace) {
  localStorage.removeItem(storageKey(uid, namespace))
}

export function secureStorageKey(uid, namespace) {
  return storageKey(uid, namespace)
}

