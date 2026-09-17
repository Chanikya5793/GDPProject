import { apiFetch, idempotencyKey } from '../api/client'
import { setSecureItem } from '../security/cryptoStore'

const LEGACY_KEYS = ['nw_tasks', 'nw_reminders', 'nw_notes']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const PRIORITIES = new Set(['low', 'medium', 'high'])

function readLegacy(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    // Only plain records count. The old planner wrote arrays of objects;
    // anything else here is damage, not data, and a single stray entry must
    // not stop the rest from moving.
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : []
  } catch {
    return []
  }
}

export function legacyDataSummary() {
  return LEGACY_KEYS.reduce((summary, key) => {
    summary[key] = readLegacy(key).length
    return summary
  }, {})
}

export function hasLegacyPlannerData() {
  return Object.values(legacyDataSummary()).some(Boolean)
}

// Each field is coerced to what the server accepts, because the server is
// strict and the old planner was not: a title of spaces, a time typed as
// "9:00", a priority someone capitalised by hand. A record the server would
// reject is a record that never moves, and the student cannot fix it from
// the banner.
function title(value, fallback) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, 500) : fallback
}

function isoDate(value) {
  const text = String(value ?? '').trim().slice(0, 10)
  return ISO_DATE.test(text) && !Number.isNaN(Date.parse(text)) ? text : null
}

function clock(value) {
  const text = String(value ?? '').trim()
  if (CLOCK.test(text)) return text
  // "9:05" was accepted by the old form.
  const short = /^(\d):([0-5]\d)$/.exec(text)
  return short ? `0${short[1]}:${short[2]}` : null
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function taskContent(item) {
  const priority = String(item.priority ?? '').toLowerCase()
  const minutes = Number(item.estimatedMinutes)
  return {
    entity_type: 'task', title: title(item.title, 'Untitled task'),
    due_date: isoDate(item.dueDate), due_time: clock(item.dueTime),
    priority: PRIORITIES.has(priority) ? priority : 'medium',
    category: title(item.category, 'Other'), notes: text(item.notes),
    completed: Boolean(item.completed),
    estimated_minutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(5, Math.round(minutes))) : 30,
  }
}

function reminderContent(item) {
  return {
    entity_type: 'reminder', title: title(item.title, 'Untitled reminder'),
    date: isoDate(item.date) || new Date().toISOString().slice(0, 10), time: clock(item.time),
    notes: text(item.notes), completed: Boolean(item.completed),
  }
}

function noteContent(item) {
  const tags = Array.isArray(item.tagIds) ? item.tagIds : []
  return {
    entity_type: 'note', title: title(item.title, 'Untitled note'), body: text(item.body),
    tag_ids: tags.map(String).filter(id => RECORD_ID.test(id)),
    attachments: [],
  }
}

export function legacyItems() {
  const mappings = [
    ['nw_tasks', taskContent], ['nw_reminders', reminderContent], ['nw_notes', noteContent],
  ]
  return mappings.flatMap(([legacyKey, convert]) => readLegacy(legacyKey).map((item, index) => ({
    legacy_key: legacyKey,
    legacy_id: typeof item.id === 'number' || typeof item.id === 'string' ? item.id : index,
    content: convert(item),
    approved_for_ai: false,
  })))
}

export async function migrateLegacyPlannerData(uid) {
  const migrationId = localStorage.getItem('nw_migration_id') || idempotencyKey('legacy-migration')
  localStorage.setItem('nw_migration_id', migrationId)
  const result = await apiFetch('/v1/migrations/local-storage', {
    method: 'POST', body: JSON.stringify({ migration_id: migrationId, items: legacyItems() }),
  })
  await setSecureItem(uid, 'migration:legacy-v1', {
    migrationId, completedAt: new Date().toISOString(), result,
  })
  LEGACY_KEYS.forEach(key => localStorage.removeItem(key))
  localStorage.removeItem('nw_trash')
  localStorage.removeItem('nw_logs')
  return result
}
