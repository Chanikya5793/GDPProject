import { beforeEach, describe, expect, it, vi } from 'vitest'

// A scriptable planner API. Each test decides how the server answers; the
// store under test sees only apiFetch, exactly as it does in the app.
const server = vi.hoisted(() => ({
  configured: true,
  online: true,
  records: new Map(),
  calls: [],
  reset() {
    this.configured = true
    this.online = true
    this.records = new Map()
    this.calls = []
  },
}))

vi.mock('./client', () => {
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code }
  }
  async function apiFetch(path, options = {}) {
    if (!server.configured) throw new ApiError('not configured', 503, 'not_configured')
    if (!server.online) throw new TypeError('Failed to fetch')
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    server.calls.push({ method, path, body })
    if (path.startsWith('/v1/index/')) return method === 'DELETE' ? null : { status: 'indexed' }
    const [, , , entity, id] = path.split('/')
    if (method === 'GET') {
      return [...server.records.values()].filter(record => record.content.entity_type === entity)
    }
    const current = server.records.get(id)
    if (method === 'DELETE') {
      if (!current) throw new ApiError('gone', 404, 'not_found')
      if (current.revision !== body.expected_revision) throw new ApiError('stale', 409, 'stale_revision')
      server.records.delete(id)
      return null
    }
    if (current && current.revision !== body.expected_revision) {
      throw new ApiError('stale', 409, 'stale_revision')
    }
    const record = {
      record_id: id, revision: (current?.revision || 0) + 1, approved_for_ai: body.approved_for_ai,
      created_at: '2026-09-17T00:00:00Z', updated_at: '2026-09-17T00:00:00Z', content: body.content,
    }
    server.records.set(id, record)
    return record
  }
  return { ApiError, apiFetch, idempotencyKey: prefix => `${prefix}-${Math.random().toString(36).slice(2)}` }
})

import { createRecord, deleteRecord, flushPlannerOutbox, listRecords, updateRecord } from './plannerStore'
import { getSecureItem } from '../security/cryptoStore'

const UID = 'user-1'
const outbox = () => getSecureItem(UID, 'sync:outbox', [])

describe('plannerStore', () => {
  beforeEach(() => {
    server.reset()
    sessionStorage.setItem('nw_authenticated_uid', UID)
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('keeps every change from a concurrent batch of updates', async () => {
    const a = await createRecord('task', { title: 'a', dueDate: '2026-09-20' })
    const b = await createRecord('task', { title: 'b', dueDate: '2026-09-20' })
    const c = await createRecord('task', { title: 'c', dueDate: '2026-09-20' })
    server.online = false
    await Promise.all([
      updateRecord('task', a.id, { dueDate: '2026-09-21' }),
      updateRecord('task', b.id, { dueDate: '2026-09-22' }),
      updateRecord('task', c.id, { dueDate: '2026-09-23' }),
    ])
    const cached = await getSecureItem(UID, 'records:tasks', [])
    expect(cached.map(task => task.dueDate).sort()).toEqual(['2026-09-21', '2026-09-22', '2026-09-23'])
    expect(await outbox()).toHaveLength(3)
  })

  it('chains revisions through the outbox so two offline edits of one record both land', async () => {
    const task = await createRecord('task', { title: 'draft', dueDate: '2026-09-20' })
    server.online = false
    await updateRecord('task', task.id, { title: 'first edit' })
    await updateRecord('task', task.id, { title: 'second edit' })
    expect(await outbox()).toHaveLength(2)
    server.online = true
    const result = await flushPlannerOutbox()
    expect(result).toEqual({ pending: 0, dropped: 0 })
    expect(server.records.get(task.id).content.title).toBe('second edit')
    expect(server.records.get(task.id).revision).toBe(3)
  })

  it('drops an operation the server will always refuse instead of wedging the queue', async () => {
    const task = await createRecord('task', { title: 'mine', dueDate: '2026-09-20' })
    const other = await createRecord('task', { title: 'other', dueDate: '2026-09-20' })
    server.online = false
    await updateRecord('task', task.id, { title: 'edited offline' })
    await updateRecord('task', other.id, { title: 'also edited offline' })
    // Meanwhile another device changed the first record.
    server.records.get(task.id).revision = 5
    server.online = true
    const result = await flushPlannerOutbox()
    expect(result).toEqual({ pending: 0, dropped: 1 })
    expect(server.records.get(other.id).content.title).toBe('also edited offline')
  })

  it('holds the whole queue, in order, while the server is unreachable', async () => {
    const task = await createRecord('task', { title: 'mine', dueDate: '2026-09-20' })
    server.online = false
    await updateRecord('task', task.id, { title: 'one' })
    await updateRecord('task', task.id, { title: 'two' })
    expect(await flushPlannerOutbox()).toEqual({ pending: 2, dropped: 0 })
    expect((await outbox()).map(op => op.body.content.title)).toEqual(['one', 'two'])
  })

  it('stores nothing in the outbox when there is no server to send to', async () => {
    server.configured = false
    const task = await createRecord('task', { title: 'demo', dueDate: '2026-09-20' })
    await updateRecord('task', task.id, { title: 'demo edited' })
    await deleteRecord('task', task.id)
    expect(await outbox()).toEqual([])
    expect(task._pending).toBe(false)
    expect(await listRecords('task')).toEqual([])
  })

  it('reads the offline cache when the server is unreachable', async () => {
    await createRecord('task', { title: 'kept', dueDate: '2026-09-20' })
    server.online = false
    expect((await listRecords('task')).map(task => task.title)).toEqual(['kept'])
  })

  it('surfaces a refused request rather than caching it', async () => {
    await createRecord('task', { title: 'kept', dueDate: '2026-09-20' })
    const stale = await getSecureItem(UID, 'records:tasks', [])
    server.records.get(stale[0].id).revision = 9
    await expect(updateRecord('task', stale[0].id, { title: 'stale' })).rejects.toMatchObject({ status: 409 })
    expect(await outbox()).toEqual([])
  })

  it('treats a delete of a record already gone from the server as done', async () => {
    const task = await createRecord('task', { title: 'gone', dueDate: '2026-09-20' })
    server.records.delete(task.id)
    await expect(deleteRecord('task', task.id)).resolves.toBeUndefined()
    expect(await getSecureItem(UID, 'records:tasks', [])).toEqual([])
    expect(await outbox()).toEqual([])
  })

  it('adopts attachments added elsewhere when the device has none', async () => {
    const note = await createRecord('note', { title: 'n', body: 'b', attachments: [] })
    server.records.get(note.id).content.attachments = [
      { attachment_id: 'a1', filename: 'syllabus.txt', text: 'week 1', approved_for_ai: true },
    ]
    server.records.get(note.id).revision = 2
    const [listed] = await listRecords('note')
    expect(listed.attachments).toEqual([
      { id: 'a1', name: 'syllabus.txt', text: 'week 1', approvedForAi: true },
    ])
  })
})
