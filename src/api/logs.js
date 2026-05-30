/* Lightweight session activity log.
   Records create/update/delete actions across tasks, reminders, notes and
   tags so the Settings page can show what changed in each session. */

const LOGS_KEY = 'nw_logs'
const MAX_LOGS = 300
const DEDUPE_WINDOW_MS = 5000

// A fresh session id is generated on every page load.
export const SESSION_ID = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const SESSION_START = new Date().toISOString()

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

/* Append an entry. action: 'created'|'updated'|'deleted'|'completed'|...
   entity: 'task'|'reminder'|'note'|'tag'. title: the item's label. */
export function addLog(action, entity, title = '') {
  const logs = load()
  const now = Date.now()
  // Collapse repeated identical actions within a short window (e.g. note
  // autosave) — but only within the same session, so reloading the page never
  // folds a new entry into a previous session's grouping.
  const last = logs[0]
  if (last && last.sessionId === SESSION_ID && last.action === action
      && last.entity === entity && last.title === title
      && now - new Date(last.ts).getTime() < DEDUPE_WINDOW_MS) {
    last.ts = new Date(now).toISOString()
    save(logs.slice(0, MAX_LOGS))
    return
  }
  logs.unshift({
    id: `${now}_${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date(now).toISOString(),
    sessionId: SESSION_ID,
    sessionStart: SESSION_START,
    action,
    entity,
    title,
  })
  save(logs.slice(0, MAX_LOGS))
}

export async function getLogs() {
  return load()
}

export function clearLogs() {
  save([])
}
