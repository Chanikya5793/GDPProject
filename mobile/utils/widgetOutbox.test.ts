import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ uid: 'u1', data: {} as Record<string, unknown>, request: vi.fn(), write: vi.fn() }));
vi.mock('@/api/storage', () => ({
  getStorageUid: () => mocks.uid,
  getItem: async (key: string, fallback: unknown) => structuredClone(mocks.data[key] ?? fallback),
  setItem: mocks.write,
}));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/api/client', () => ({
  apiRequest: mocks.request,
  idempotencyKey: (prefix: string) => `${prefix}-test`,
  ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } },
}));

const task = { id: 7, userId: 'u1', title: 'Assignment', dueDate: '2026-09-17', dueTime: '',
  category: 'Homework', priority: 'high', notes: '', completed: false, _revision: 2 };
const server = (completed = false) => ({ record_id: '7', revision: completed ? 3 : 2,
  approved_for_ai: false, created_at: '2026-09-01', updated_at: '2026-09-17',
  content: { entity_type: 'task', title: task.title, due_date: task.dueDate, due_time: '',
    priority: 'high', category: 'Homework', completed } });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.uid = 'u1';
  mocks.data = { nw_tasks: [task], nw_sync_outbox: [] };
  mocks.write.mockImplementation(async (key: string, value: unknown) => { mocks.data[key] = structuredClone(value); });
  mocks.request.mockRejectedValue(Object.assign(new Error('Offline'), { status: 503 }));
});

describe('widget mutation and outbox ordering', () => {
  it('falls back to a full update on a backend without the complete endpoint', async () => {
    const api = await import('@/api/plannerClient');
    await api.updatePlannerItem('task', 7, { completed: true },
      { userId: 'u1', revision: 2, date: '2026-09-17', time: '' }, true, 'widget-command-1');
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/complete')) throw Object.assign(new Error('Not Found'), { status: 404 });
      return server(true);
    });
    expect(await api.flushOutbox()).toBe(0);
    const [path, init] = mocks.request.mock.calls.at(-1)!;
    expect(path).toBe('/v1/records/task/7');
    expect(JSON.parse(init.body)).toMatchObject({ expected_revision: 2, idempotency_key: 'widget-command-1-put',
      content: { entity_type: 'task', completed: true, notes: '' } });
    expect(mocks.data.nw_sync_conflicts).toBeUndefined();
  });
  it('treats a record that is gone as done, without falling back', async () => {
    const api = await import('@/api/plannerClient');
    await api.updatePlannerItem('task', 7, { completed: true },
      { userId: 'u1', revision: 2, date: '2026-09-17', time: '' }, true, 'widget-command-1');
    mocks.request.mockRejectedValue(Object.assign(new Error('Record not found'), { status: 404, code: 'not_found' }));
    expect(await api.flushOutbox()).toBe(0);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.data.nw_sync_conflicts).toBeUndefined();
  });
  it('replays a widget tick through the complete endpoint under the widget command id', async () => {
    const api = await import('@/api/plannerClient');
    const pending = await api.updatePlannerItem('task', 7, { completed: true },
      { userId: 'u1', revision: 2, date: '2026-09-17', time: '' }, true, 'widget-command-1');
    expect(pending).toMatchObject({ completed: true, _pending: true });
    expect(mocks.request).not.toHaveBeenCalled();
    // The extension already sent it: the server answers with the done record.
    mocks.request.mockResolvedValue(server(true));
    expect(await api.flushOutbox()).toBe(0);
    expect(mocks.request).toHaveBeenCalledWith('/v1/records/task/7/complete', {
      method: 'POST', body: JSON.stringify({ expected_revision: 2, idempotency_key: 'widget-command-1' }),
    });
    expect(mocks.data.nw_sync_conflicts).toBeUndefined();
  });
  it('drops a conflicting operation and still sends the ones behind it', async () => {
    const outbox = [1, 2, 3].map(recordId => ({ method: 'PUT', kind: 'task', recordId, body: {} }));
    mocks.data.nw_sync_outbox = outbox;
    const sent: number[] = [];
    mocks.request.mockImplementation(async (path: string) => {
      const recordId = Number(path.split('/').pop());
      sent.push(recordId);
      if (recordId === 1) throw Object.assign(new Error('Conflict'), { status: 409 });
      return server(true);
    });
    const api = await import('@/api/plannerClient');
    expect(await api.flushOutbox()).toBe(0);
    expect(sent).toEqual([1, 2, 3]);
    expect(mocks.data.nw_sync_outbox).toEqual([]);
  });
  it('keeps the whole queue, in order, while the server is unreachable', async () => {
    const outbox = [1, 2, 3].map(recordId => ({ method: 'PUT', kind: 'task', recordId, body: {} }));
    mocks.data.nw_sync_outbox = outbox;
    mocks.request.mockRejectedValue(new TypeError('Network request failed'));
    const api = await import('@/api/plannerClient');
    expect(await api.flushOutbox()).toBe(3);
    expect(mocks.data.nw_sync_outbox).toEqual(outbox);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('does not drop concurrent offline task and reminder completions', async () => {
    mocks.data.nw_reminders = [{ id: 'r1', userId: 'u1', title: 'Reminder', date: '2026-09-17', time: '', completed: false, _revision: 1 }];
    const api = await import('@/api/plannerClient');
    await Promise.all([
      api.updatePlannerItem('task', 7, { completed: true }),
      api.updatePlannerItem('reminder', 'r1', { completed: true }),
    ]);
    expect(mocks.data.nw_sync_outbox).toHaveLength(2);
    expect((mocks.data.nw_tasks as typeof task[])[0].completed).toBe(true);
  });
  it('rejects a widget action when the record changed before mutation execution', async () => {
    const api = await import('@/api/plannerClient');
    await expect(api.updatePlannerItem('task', 7, { completed: true }, {
      userId: 'u1', revision: 1, date: task.dueDate, time: '',
    })).rejects.toMatchObject({ status: 409 });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('serializes a refresh with the completion so an old fetch cannot overwrite it', async () => {
    let resume!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    mocks.request.mockImplementation(async (_: string, options?: { method?: string }) => {
      if (options?.method === 'PUT') return server(true);
      if (options?.method === 'DELETE') return undefined;
      await blocked;
      return [server(false)];
    });
    const api = await import('@/api/plannerClient');
    const refreshing = api.listPlannerItems('task');
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled());
    const completing = api.updatePlannerItem('task', 7, { completed: true });
    resume();
    await Promise.all([refreshing, completing]);
    expect((mocks.data.nw_tasks as typeof task[])[0].completed).toBe(true);
  });
  it('never caches or queues a late response into the next account', async () => {
    let resume!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    mocks.request.mockImplementation(async () => { await blocked; return server(true); });
    const api = await import('@/api/plannerClient');
    const mutation = api.updatePlannerItem('task', 7, { completed: true });
    const rejected = expect(mutation).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled());
    mocks.uid = 'u2'; resume();
    await rejected;
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
