import { getSecureCollection, setSecureCollection } from './secureCollections'

const NAMESPACE = 'audit:activity'
const MAX_LOGS = 300
const DEDUPE_WINDOW_MS = 5000

export const SESSION_ID = `s_${Date.now()}_${crypto.randomUUID().slice(0, 7)}`
const SESSION_START = new Date().toISOString()
let suppressDepth = 0

export async function suppressLogging(callback) {
  suppressDepth += 1
  try {
    return await callback()
  } finally {
    suppressDepth -= 1
  }
}

async function load() {
  return getSecureCollection(NAMESPACE, [])
}

async function save(logs) {
  return setSecureCollection(NAMESPACE, logs.slice(0, MAX_LOGS))
}

function sanitizeSnapshot(value) {
  if (!value || typeof value !== 'object') return value
  const clone = { ...value }
  if (Array.isArray(clone.attachments)) {
    clone.attachments = clone.attachments.map(attachment => ({
      name: attachment?.name, size: attachment?.size, type: attachment?.type,
    }))
  }
  return clone
}

export async function addLog(action, entity, title = '', payload = {}) {
  if (suppressDepth > 0) return null
  const logs = await load()
  const now = Date.now()
  const last = logs[0]
  if (last && last.sessionId === SESSION_ID && last.action === action &&
      last.entity === entity && last.title === title && !last.reverted &&
      now - new Date(last.ts).getTime() < DEDUPE_WINDOW_MS) {
    last.ts = new Date(now).toISOString()
    if (payload.after !== undefined) last.after = sanitizeSnapshot(payload.after)
    await save(logs)
    return last.id
  }
  const entry = {
    id: crypto.randomUUID(), ts: new Date(now).toISOString(), sessionId: SESSION_ID,
    sessionStart: SESSION_START, action, entity, title,
    ...(payload.entityId !== undefined ? { entityId: payload.entityId } : {}),
    ...(payload.before !== undefined ? { before: sanitizeSnapshot(payload.before) } : {}),
    ...(payload.after !== undefined ? { after: sanitizeSnapshot(payload.after) } : {}),
    ...(payload.trashId ? { trashId: payload.trashId } : {}),
    ...(payload.revertOf ? { revertOf: payload.revertOf } : {}),
  }
  await save([entry, ...logs])
  return entry.id
}

export async function getLogs() {
  return load()
}

export async function clearLogs() {
  await save([])
}

export async function deleteLogs(ids) {
  const selected = new Set(ids)
  await save((await load()).filter(log => !selected.has(log.id)))
}

export async function markReverted(id) {
  const logs = await load()
  const entry = logs.find(log => log.id === id)
  if (entry) {
    entry.reverted = true
    entry.revertedAt = new Date().toISOString()
    await save(logs)
  }
}

