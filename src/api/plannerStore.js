import { apiFetch, idempotencyKey } from './client'
import { getSecureItem, setSecureItem } from '../security/cryptoStore'

const ENTITY_TO_CACHE = {
  task: 'records:tasks',
  reminder: 'records:reminders',
  note: 'records:notes',
  schedule: 'records:schedules',
}

function currentUid() {
  const value = sessionStorage.getItem('nw_authenticated_uid')
  if (!value) throw new Error('Authenticated user is unavailable')
  return value
}

function fromServer(record) {
  const content = record.content
  const common = {
    id: record.record_id,
    userId: currentUid(),
    _revision: record.revision,
    _approvedForAi: record.approved_for_ai,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
  if (content.entity_type === 'task') return {
    ...common, title: content.title, dueDate: content.due_date || '', dueTime: content.due_time || '',
    priority: content.priority, category: content.category, notes: content.notes,
    completed: content.completed, estimatedMinutes: content.estimated_minutes,
  }
  if (content.entity_type === 'reminder') return {
    ...common, title: content.title, date: content.date, time: content.time || '',
    notes: content.notes, completed: content.completed,
  }
  if (content.entity_type === 'note') return {
    ...common, title: content.title, body: content.body, tagIds: content.tag_ids,
    attachments: (content.attachments || []).map(item => ({
      id: item.attachment_id, name: item.filename, text: item.text,
      approvedForAi: item.approved_for_ai,
    })),
  }
  return { ...common, ...content }
}

function toServer(entityType, item) {
  if (entityType === 'task') return {
    entity_type: 'task', title: item.title, due_date: item.dueDate || null,
    due_time: item.dueTime || null, priority: item.priority || 'medium',
    category: item.category || 'Other', notes: item.notes || '',
    completed: Boolean(item.completed), estimated_minutes: item.estimatedMinutes || 30,
  }
  if (entityType === 'reminder') return {
    entity_type: 'reminder', title: item.title, date: item.date,
    time: item.time || null, notes: item.notes || '', completed: Boolean(item.completed),
  }
  if (entityType === 'note') return {
    entity_type: 'note', title: item.title || 'Untitled Note', body: item.body || '',
    tag_ids: (item.tagIds || []).map(String),
    attachments: (item.attachments || []).filter(a => a.text).map(a => ({
      attachment_id: String(a.id || a.name), filename: a.name,
      text: a.text, approved_for_ai: Boolean(a.approvedForAi),
    })),
  }
  throw new Error(`Unsupported planner entity: ${entityType}`)
}

async function cache(entityType, records) {
  await setSecureItem(currentUid(), ENTITY_TO_CACHE[entityType], records)
}

async function cached(entityType) {
  return getSecureItem(currentUid(), ENTITY_TO_CACHE[entityType], [])
}

async function outbox() {
  return getSecureItem(currentUid(), 'sync:outbox', [])
}

async function saveOutbox(items) {
  return setSecureItem(currentUid(), 'sync:outbox', items)
}

async function queue(operation) {
  const items = await outbox()
  await saveOutbox([...items, operation])
}

async function sendOperation(operation) {
  const path = `/v1/records/${operation.entityType}/${encodeURIComponent(operation.recordId)}`
  if (operation.method === 'DELETE') {
    return apiFetch(path, { method: 'DELETE', body: JSON.stringify(operation.body) })
  }
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(operation.body) })
}

async function synchronizeIndex(entityType, record) {
  if (record._approvedForAi) {
    await apiFetch(`/v1/index/${entityType}/${encodeURIComponent(record.id)}`, {
      method: 'POST',
      body: JSON.stringify({ approved: true, expected_revision: record._revision }),
    })
  } else {
    await apiFetch(`/v1/index/${entityType}/${encodeURIComponent(record.id)}`, {
      method: 'DELETE',
    })
  }
}

export async function flushPlannerOutbox() {
  const items = await outbox()
  const remaining = []
  for (const operation of items) {
    try {
      await sendOperation(operation)
    } catch (error) {
      remaining.push({ ...operation, lastError: error.code || error.message })
      if (error.status === 409) break
    }
  }
  await saveOutbox(remaining)
  return { pending: remaining.length }
}

export async function listRecords(entityType) {
  try {
    await flushPlannerOutbox()
    const localRecords = await cached(entityType)
    const records = (await apiFetch(`/v1/records/${entityType}`)).map(fromServer).map(record => {
      if (entityType !== 'note') return record
      const local = localRecords.find(item => String(item.id) === String(record.id))
      return { ...record, attachments: local?.attachments || record.attachments }
    })
    await cache(entityType, records)
    return records
  } catch (error) {
    const records = await cached(entityType)
    if (records.length || !navigator.onLine || error.code === 'not_configured') return records
    throw error
  }
}

export async function createRecord(entityType, values) {
  const recordId = String(values.id || crypto.randomUUID())
  const local = {
    ...values, id: recordId, userId: currentUid(), _revision: 1, _pending: false,
    createdAt: values.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const operation = {
    method: 'PUT', entityType, recordId,
    body: {
      content: toServer(entityType, local), expected_revision: null,
      idempotency_key: idempotencyKey(`create-${entityType}`),
      approved_for_ai: Boolean(values._approvedForAi),
    },
  }
  try {
    const serverRecord = fromServer(await sendOperation(operation))
    const saved = entityType === 'note'
      ? { ...serverRecord, attachments: local.attachments || serverRecord.attachments }
      : serverRecord
    await cache(entityType, [...await cached(entityType), saved])
    try { await synchronizeIndex(entityType, saved) } catch { /* approval persists; privacy may block indexing */ }
    return saved
  } catch (error) {
    if (error.status && error.status < 500 && error.code !== 'not_configured') throw error
    local._pending = true
    await queue(operation)
    await cache(entityType, [...await cached(entityType), local])
    return local
  }
}

export async function updateRecord(entityType, recordId, updates) {
  const records = await cached(entityType)
  const current = records.find(record => String(record.id) === String(recordId))
  if (!current) throw new Error('Record is not available in the encrypted offline cache')
  const merged = { ...current, ...updates, updatedAt: new Date().toISOString() }
  const operation = {
    method: 'PUT', entityType, recordId: String(recordId),
    body: {
      content: toServer(entityType, merged), expected_revision: current._revision,
      idempotency_key: idempotencyKey(`update-${entityType}`),
      approved_for_ai: Boolean(merged._approvedForAi),
    },
  }
  try {
    const serverRecord = fromServer(await sendOperation(operation))
    const saved = entityType === 'note'
      ? { ...serverRecord, attachments: merged.attachments || serverRecord.attachments }
      : serverRecord
    await cache(entityType, records.map(record => String(record.id) === String(recordId) ? saved : record))
    try { await synchronizeIndex(entityType, saved) } catch { /* approval persists; privacy may block indexing */ }
    return saved
  } catch (error) {
    if (error.status && error.status < 500 && error.code !== 'not_configured') throw error
    merged._pending = true
    await queue(operation)
    await cache(entityType, records.map(record => String(record.id) === String(recordId) ? merged : record))
    return merged
  }
}

export async function deleteRecord(entityType, recordId) {
  const records = await cached(entityType)
  const current = records.find(record => String(record.id) === String(recordId))
  if (!current) return
  const operation = {
    method: 'DELETE', entityType, recordId: String(recordId),
    body: {
      expected_revision: current._revision,
      idempotency_key: idempotencyKey(`delete-${entityType}`),
    },
  }
  try {
    await sendOperation(operation)
  } catch (error) {
    if (error.status && error.status < 500 && error.code !== 'not_configured') throw error
    await queue(operation)
  }
  await cache(entityType, records.filter(record => String(record.id) !== String(recordId)))
}

export async function replaceCachedRecords(entityType, records) {
  await cache(entityType, records)
}
