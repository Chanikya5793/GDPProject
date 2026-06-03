/* Session activity log with version-control-style snapshots.

   Records create/update/delete/toggle actions across tasks, reminders, notes
   and tags. Each entry can carry a sanitized before/after snapshot of the item
   so the Settings page can render verbose field-level diffs and roll an
   individual change back (see ./activity.js for the revert engine). */

const LOGS_KEY = 'nw_logs'
const MAX_LOGS = 300
const DEDUPE_WINDOW_MS = 5000

// A fresh session id is generated on every page load.
export const SESSION_ID = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const SESSION_START = new Date().toISOString()

// While a rollback is being applied we re-use the normal entity APIs (which log
// their own actions). suppressLogging() mutes those so a revert produces exactly
// one explicit 'reverted' entry instead of a confusing duplicate.
let _suppressDepth = 0
export async function suppressLogging(fn) {
  _suppressDepth++
  try {
    return await fn()
  } finally {
    _suppressDepth--
  }
}

function load() {
  try {
    const raw = localStorage.getItem(LOGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    localStorage.removeItem(LOGS_KEY)
    return []
  }
}

function save(logs) {
  // Activity logging must never block or fail the user action that triggered
  // it — localStorage can throw when full (note attachments also live here).
  try {
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs))
  } catch { /* out of storage — drop the log entry silently */ }
}

/* Strip volatile and heavy fields from a snapshot before persisting. The biggest
   offender is note attachments, whose dataUrl holds base64 (up to ~2 MB each);
   we keep the metadata so the diff can still say "added 1 attachment". */
function sanitizeSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const clone = { ...obj }
  if (Array.isArray(clone.attachments)) {
    clone.attachments = clone.attachments.map(a =>
      a && typeof a === 'object'
        ? { name: a.name, size: a.size, type: a.type } // drop dataUrl/base64
        : a
    )
  }
  return clone
}

/* Append an entry.
   action : 'created'|'updated'|'deleted'|'completed'|'reopened'|'reverted'
   entity : 'task'|'reminder'|'note'|'tag'
   title  : the item's label
   payload: { entityId, before, after, trashId, revertOf } — all optional */
export function addLog(action, entity, title = '', payload = {}) {
  if (_suppressDepth > 0) return null
  const logs = load()
  const now = Date.now()
  const { entityId, before, after, trashId, revertOf } = payload

  // Collapse repeated identical actions within a short window (e.g. note
  // autosave) — but only within the same session, and never fold into a
  // reverted entry. We keep the FIRST entry's `before` (so a rollback returns
  // to the pre-burst state) while refreshing `after` to the latest snapshot.
  const last = logs[0]
  if (last && last.sessionId === SESSION_ID && last.action === action
      && last.entity === entity && last.title === title && !last.reverted
      && now - new Date(last.ts).getTime() < DEDUPE_WINDOW_MS) {
    last.ts = new Date(now).toISOString()
    if (after !== undefined) last.after = sanitizeSnapshot(after)
    save(logs.slice(0, MAX_LOGS))
    return last.id
  }

  const id = `${now}_${Math.random().toString(36).slice(2, 7)}`
  logs.unshift({
    id,
    ts: new Date(now).toISOString(),
    sessionId: SESSION_ID,
    sessionStart: SESSION_START,
    action,
    entity,
    title,
    ...(entityId !== undefined ? { entityId } : {}),
    ...(before !== undefined ? { before: sanitizeSnapshot(before) } : {}),
    ...(after !== undefined ? { after: sanitizeSnapshot(after) } : {}),
    ...(trashId ? { trashId } : {}),
    ...(revertOf ? { revertOf } : {}),
  })
  save(logs.slice(0, MAX_LOGS))
  return id
}

export async function getLogs() {
  return load()
}

export function clearLogs() {
  save([])
}

/* Remove specific entries by id (multi-select delete). */
export function deleteLogs(ids) {
  const set = new Set(ids)
  save(load().filter(l => !set.has(l.id)))
}

/* Flag an entry as reverted so the UI can badge it and disable re-rollback. */
export function markReverted(id) {
  const logs = load()
  const entry = logs.find(l => l.id === id)
  if (entry) {
    entry.reverted = true
    entry.revertedAt = new Date().toISOString()
    save(logs)
  }
}
