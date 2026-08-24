import { apiFetch, idempotencyKey } from '../api/client'
import { setSecureItem } from '../security/cryptoStore'

const LEGACY_KEYS = ['nw_tasks', 'nw_reminders', 'nw_notes']

function readLegacy(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
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

function taskContent(item) {
  return {
    entity_type: 'task', title: item.title || 'Untitled task', due_date: item.dueDate || null,
    due_time: item.dueTime || null, priority: item.priority || 'medium',
    category: item.category || 'Other', notes: item.notes || '',
    completed: Boolean(item.completed), estimated_minutes: item.estimatedMinutes || 30,
  }
}

function reminderContent(item) {
  return {
    entity_type: 'reminder', title: item.title || 'Untitled reminder',
    date: item.date || new Date().toISOString().slice(0, 10), time: item.time || null,
    notes: item.notes || '', completed: Boolean(item.completed),
  }
}

function noteContent(item) {
  return {
    entity_type: 'note', title: item.title || 'Untitled note', body: item.body || '',
    tag_ids: (item.tagIds || []).map(String),
    attachments: [],
  }
}

export async function migrateLegacyPlannerData(uid) {
  const migrationId = localStorage.getItem('nw_migration_id') || idempotencyKey('legacy-migration')
  localStorage.setItem('nw_migration_id', migrationId)
  const mappings = [
    ['nw_tasks', taskContent], ['nw_reminders', reminderContent], ['nw_notes', noteContent],
  ]
  const items = mappings.flatMap(([legacyKey, convert]) => readLegacy(legacyKey).map((item, index) => ({
    legacy_key: legacyKey,
    legacy_id: item.id ?? index,
    content: convert(item),
    approved_for_ai: false,
  })))
  const result = await apiFetch('/v1/migrations/local-storage', {
    method: 'POST', body: JSON.stringify({ migration_id: migrationId, items }),
  })
  await setSecureItem(uid, 'migration:legacy-v1', {
    migrationId, completedAt: new Date().toISOString(), result,
  })
  LEGACY_KEYS.forEach(key => localStorage.removeItem(key))
  localStorage.removeItem('nw_trash')
  localStorage.removeItem('nw_logs')
  return result
}

