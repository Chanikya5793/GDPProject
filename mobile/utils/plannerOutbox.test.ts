import { beforeEach, describe, expect, it, vi } from 'vitest';

// A scriptable planner API. Each test decides how the server answers; the
// store under test sees only apiRequest, exactly as it does in the app. The
// same cases as the web store's src/api/plannerStore.test.js: the two share
// the outbox contract.
const server = vi.hoisted(() => ({
  configured: true,
  online: true,
  records: new Map<string, { record_id: string; revision: number; approved_for_ai: boolean; created_at: string; updated_at: string; content: Record<string, unknown> }>(),
  reset() { this.configured = true; this.online = true; this.records = new Map(); },
}));
const store = vi.hoisted(() => new Map<string, unknown>());
const { ApiError } = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) { super(message); }
  },
}));

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'u1' } }, firebaseConfigured: true }));
vi.mock('@/api/storage', () => ({
  getStorageUid: () => 'u1',
  setStorageUid: () => {},
  getItem: async <T,>(key: string, fallback: T) => (store.has(key) ? structuredClone(store.get(key)) as T : fallback),
  setItem: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
}));
vi.mock('@/api/client', () => ({
  ApiError,
  idempotencyKey: (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`,
  apiRequest: async (path: string, options: { method?: string; body?: string } = {}) => {
    if (!server.configured) throw new ApiError('not configured', 503, 'not_configured');
    if (!server.online) throw new TypeError('Network request failed');
    const method = options.method || 'GET';
    if (path.startsWith('/v1/index/')) return { status: 'indexed' };
    const [, , , entity, id] = path.split('/');
    const body = options.body ? JSON.parse(options.body) : null;
    if (method === 'GET') return [...server.records.values()].filter(r => r.content.entity_type === entity);
    const current = server.records.get(id);
    if (method === 'DELETE') {
      if (!current) throw new ApiError('gone', 404, 'not_found');
      if (current.revision !== body.expected_revision) throw new ApiError('stale', 409, 'stale_revision');
      server.records.delete(id);
      return undefined;
    }
    if (current && current.revision !== body.expected_revision) throw new ApiError('stale', 409, 'stale_revision');
    const record = {
      record_id: id, revision: (current?.revision || 0) + 1, approved_for_ai: body.approved_for_ai,
      created_at: '2026-09-17T00:00:00Z', updated_at: '2026-09-17T00:00:00Z', content: body.content,
    };
    server.records.set(id, record);
    return record;
  },
}));

import { createPlannerItem, deletePlannerItem, flushOutbox, listPlannerItems, updatePlannerItem } from '@/api/plannerClient';
import { Task } from '@/types';

let nextId = 1000;
const task = (title: string): Task => ({
  id: nextId++, userId: 'u1', title, dueDate: '2026-09-20', dueTime: '', category: 'Homework',
  priority: 'medium', notes: '', completed: false, createdAt: '2026-09-17T00:00:00Z',
});
const outbox = () => (store.get('nw_sync_outbox') as unknown[] | undefined) ?? [];
const cached = () => (store.get('nw_tasks') as Task[] | undefined) ?? [];

describe('mobile planner outbox', () => {
  beforeEach(() => { server.reset(); store.clear(); });

  it('keeps every change from a concurrent batch of updates', async () => {
    const a = await createPlannerItem('task', task('a'));
    const b = await createPlannerItem('task', task('b'));
    const c = await createPlannerItem('task', task('c'));
    server.online = false;
    await Promise.all([
      updatePlannerItem<Task>('task', a.id, { dueDate: '2026-09-21' }),
      updatePlannerItem<Task>('task', b.id, { dueDate: '2026-09-22' }),
      updatePlannerItem<Task>('task', c.id, { dueDate: '2026-09-23' }),
    ]);
    expect(cached().map(t => t.dueDate).sort()).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
    expect(outbox()).toHaveLength(3);
  });

  it('chains revisions through the outbox so two offline edits of one record both land', async () => {
    const t = await createPlannerItem('task', task('draft'));
    server.online = false;
    await updatePlannerItem<Task>('task', t.id, { title: 'first edit' });
    await updatePlannerItem<Task>('task', t.id, { title: 'second edit' });
    expect(outbox()).toHaveLength(2);
    server.online = true;
    expect(await flushOutbox()).toBe(0);
    expect(server.records.get(String(t.id))!.content.title).toBe('second edit');
    expect(server.records.get(String(t.id))!.revision).toBe(3);
  });

  it('drops an operation the server will always refuse instead of wedging the queue', async () => {
    const mine = await createPlannerItem('task', task('mine'));
    const other = await createPlannerItem('task', task('other'));
    server.online = false;
    await updatePlannerItem<Task>('task', mine.id, { title: 'edited offline' });
    await updatePlannerItem<Task>('task', other.id, { title: 'also edited offline' });
    server.records.get(String(mine.id))!.revision = 5; // changed on another device meanwhile
    server.online = true;
    expect(await flushOutbox()).toBe(0);
    expect(server.records.get(String(other.id))!.content.title).toBe('also edited offline');
  });

  it('stores nothing in the outbox when there is no server to send to', async () => {
    server.configured = false;
    const t = await createPlannerItem('task', task('demo'));
    expect(t._pending).toBeFalsy();
    await updatePlannerItem<Task>('task', t.id, { title: 'demo edited' });
    await deletePlannerItem('task', t.id);
    expect(outbox()).toEqual([]);
    expect(await listPlannerItems<Task>('task')).toEqual([]);
  });

  it('surfaces a refused request rather than caching it', async () => {
    const t = await createPlannerItem('task', task('kept'));
    server.records.get(String(t.id))!.revision = 9;
    await expect(updatePlannerItem<Task>('task', t.id, { title: 'stale' })).rejects.toMatchObject({ status: 409 });
    expect(outbox()).toEqual([]);
  });

  it('treats a delete of a record already gone from the server as done', async () => {
    const t = await createPlannerItem('task', task('gone'));
    server.records.delete(String(t.id));
    await expect(deletePlannerItem('task', t.id)).resolves.toBeUndefined();
    expect(cached()).toEqual([]);
    expect(outbox()).toEqual([]);
  });

  it('does not double a record created twice with the same id', async () => {
    const t = task('once');
    server.online = false;
    await createPlannerItem('task', t);
    server.online = true;
    await createPlannerItem('task', { ...t, title: 'again' });
    expect(cached().filter(item => item.id === t.id)).toHaveLength(1);
  });
});
