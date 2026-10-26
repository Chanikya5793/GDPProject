import { apiFetch, idempotencyKey } from './client'
import { getSecureItem, setSecureItem, updateSecureItem, withSecureLock } from '../security/cryptoStore'

const ENTITY_TO_CACHE = {
  task: 'records:tasks',
  reminder: 'records:reminders',
  note: 'records:notes',
  schedule: 'records:schedules',
}

const OUTBOX = 'sync:outbox'

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
    keepScheduled: Boolean(content.keep_scheduled),
    seriesId: content.series_id || null, recurrence: content.recurrence || null,
  }
  if (content.entity_type === 'reminder') return {
    ...common, title: content.title, date: content.date, time: content.time || '',
    notes: content.notes, completed: content.completed,
    seriesId: content.series_id || null, recurrence: content.recurrence || null,
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
    keep_scheduled: Boolean(item.keepScheduled),
    series_id: item.seriesId || null, recurrence: item.recurrence || null,
  }
  if (entityType === 'reminder') return {
    entity_type: 'reminder', title: item.title, date: item.date,
    time: item.time || null, notes: item.notes || '', completed: Boolean(item.completed),
    series_id: item.seriesId || null, recurrence: item.recurrence || null,
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

/**
 * Note attachments carry file data the server never sees, so the device copy
 * is kept over the server's -- but only when it has any. An empty local list
 * used to win over attachments added from another device.
 */
function withLocalAttachments(entityType, saved, local) {
  if (entityType !== 'note') return saved
  const attachments = local?.attachments?.length ? local.attachments : saved.attachments
  return attachments === saved.attachments ? saved : { ...saved, attachments }
}

const sameId = (left, right) => String(left) === String(right)

async function cached(entityType) {
  return getSecureItem(currentUid(), ENTITY_TO_CACHE[entityType], [])
}

// Every write to a collection goes through here. The collection is stored
// whole, so it has to be re-read under the lock: a batch of updates used to
// read one snapshot each and write it back each, keeping only the last.
function mutateCache(entityType, updater) {
  return updateSecureItem(currentUid(), ENTITY_TO_CACHE[entityType], [], updater)
}

async function cache(entityType, records) {
  await setSecureItem(currentUid(), ENTITY_TO_CACHE[entityType], records)
}

function queue(operation) {
  return updateSecureItem(currentUid(), OUTBOX, [], items => [...items, operation])
}

// A change that could not reach the server is kept for later only when there
// is a server to reach. The public demo has none: queueing there grew the
// outbox with every edit and replayed all of it, failing, on every load.
async function keepForLater(operation, error) {
  if (error.code === 'not_configured') return
  await queue(operation)
}

// Errors that will not go away by retrying: the request itself was refused.
// A network failure has no status; a 5xx and a missing service are worth
// another try once the connection is back.
function isPermanentFailure(error) {
  if (error.code === 'misconfigured') return true
  return Boolean(error.status && error.status < 500 && error.code !== 'not_configured')
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

/**
 * Send everything queued while offline, in order.
 *
 * Revisions are chained through the flush: an offline edit is queued with
 * the revision the device last saw, so a second edit of the same record
 * carried the same number and was refused once the first had landed. Each
 * success now feeds its new revision into the next operation on that record.
 *
 * A refusal the server will repeat -- a stale revision, a record deleted
 * elsewhere -- drops that operation and moves on; the next list refreshes
 * the record from the server. Keeping it used to block every operation
 * behind it, on every load, for good. Only a failure to reach the server
 * keeps the queue.
 */
export async function flushPlannerOutbox() {
  return withSecureLock(currentUid(), OUTBOX, async () => {
    const items = await getSecureItem(currentUid(), OUTBOX, [])
    if (!items.length) return { pending: 0, dropped: 0 }
    const remaining = []
    const revisions = {}
    let dropped = 0
    let unreachable = false
    for (const operation of items) {
      if (unreachable) {
        remaining.push(operation)
        continue
      }
      const known = revisions[operation.recordId]
      const body = known === undefined ? operation.body : { ...operation.body, expected_revision: known }
      try {
        const result = await sendOperation({ ...operation, body })
        if (operation.method === 'DELETE') delete revisions[operation.recordId]
        else if (result?.revision) revisions[operation.recordId] = result.revision
      } catch (error) {
        if (error.code === 'not_configured' || isPermanentFailure(error)) {
          dropped += 1
          continue
        }
        // Still offline. Nothing behind this can go either; keep the order.
        unreachable = true
        remaining.push({ ...operation, lastError: error.code || error.message })
      }
    }
    await setSecureItem(currentUid(), OUTBOX, remaining)
    return { pending: remaining.length, dropped }
  })
}

export async function listRecords(entityType) {
  try {
    await flushPlannerOutbox()
    const fetched = (await apiFetch(`/v1/records/${entityType}`)).map(fromServer)
    return await mutateCache(entityType, localRecords => fetched.map(record => (
      withLocalAttachments(entityType, record, localRecords.find(item => sameId(item.id, record.id)))
    )))
  } catch (error) {
    const records = await cached(entityType)
    if (records.length || !navigator.onLine || error.code === 'not_configured') return records
    throw error
  }
}

export async function createRecord(entityType, values) {
  const recordId = String(values.id || crypto.randomUUID())
  // Visible to the assistant unless the record says otherwise: the forms and
  // the phone both default to that, and a quick-add or a new note used to
  // come out hidden simply because it never mentioned the flag.
  const approved = values._approvedForAi ?? true
  const local = {
    ...values, id: recordId, userId: currentUid(), _revision: 1, _pending: false,
    _approvedForAi: approved,
    createdAt: values.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const operation = {
    method: 'PUT', entityType, recordId,
    body: {
      content: toServer(entityType, local), expected_revision: null,
      idempotency_key: idempotencyKey(`create-${entityType}`),
      approved_for_ai: approved,
    },
  }
  let saved
  try {
    saved = withLocalAttachments(entityType, fromServer(await sendOperation(operation)), local)
  } catch (error) {
    if (isPermanentFailure(error)) throw error
    saved = { ...local, _pending: error.code !== 'not_configured' }
    await keepForLater(operation, error)
  }
  await mutateCache(entityType, records => [
    ...records.filter(record => !sameId(record.id, recordId)), saved,
  ])
  if (!saved._pending) {
    try { await synchronizeIndex(entityType, saved) } catch { /* approval persists; privacy may block indexing */ }
  }
  return saved
}

export async function updateRecord(entityType, recordId, updates) {
  const current = (await cached(entityType)).find(record => sameId(record.id, recordId))
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
  let saved
  try {
    saved = withLocalAttachments(entityType, fromServer(await sendOperation(operation)), merged)
  } catch (error) {
    if (isPermanentFailure(error)) throw error
    saved = { ...merged, _pending: error.code !== 'not_configured' }
    await keepForLater(operation, error)
  }
  await mutateCache(entityType, records => records.map(record => (
    sameId(record.id, recordId) ? saved : record
  )))
  if (!saved._pending) {
    try { await synchronizeIndex(entityType, saved) } catch { /* approval persists; privacy may block indexing */ }
  }
  return saved
}

export async function deleteRecord(entityType, recordId) {
  const current = (await cached(entityType)).find(record => sameId(record.id, recordId))
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
    // Already gone on the server is the outcome asked for.
    if (isPermanentFailure(error) && error.status !== 404) throw error
    if (error.status !== 404) await keepForLater(operation, error)
  }
  await mutateCache(entityType, records => records.filter(record => !sameId(record.id, recordId)))
}

export async function replaceCachedRecords(entityType, records) {
  await cache(entityType, records)
}
