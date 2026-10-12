import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ uid: 'u1', data: {} as Record<string, unknown>, request: vi.fn(), write: vi.fn() }));
vi.mock('@/api/storage', () => ({
  getStorageUid: () => mocks.uid,
  getItem: async (key: string, fallback: unknown) => structuredClone(mocks.data[key] ?? fallback),
  setItem: mocks.write,
}));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { get uid() { return mocks.uid; } } } }));
vi.mock('@/api/client', () => ({
  apiRequest: mocks.request, idempotencyKey: () => 'test',
  ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } },
}));
const task = { id: 7, userId: 'u1', title: 'Saved locally', dueDate: '2026-10-10', dueTime: '',
  category: 'Homework', priority: 'high', notes: '', completed: false, _revision: 2, createdAt: '2026-10-01' };
const record = { record_id: '7', revision: 2, approved_for_ai: false, created_at: '2026-10-01', updated_at: '2026-10-10',
  content: { entity_type: 'task', title: task.title, due_date: task.dueDate, priority: 'high', category: task.category, completed: false } };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.uid = 'u1';
  mocks.data = { nw_tasks: [task], nw_sync_outbox: [] };
  mocks.write.mockImplementation(async (key: string, value: unknown) => { mocks.data[key] = structuredClone(value); });
  mocks.request.mockImplementation(async (path: string) => path === '/v1/records/task' ? [record] : []);
});
describe('cached iOS launch and bounded cloud refresh', () => {
  it('returns the saved planner without waiting for an in-flight cloud read', async () => {
    let resume!: () => void;
    mocks.request.mockImplementation(() => new Promise(resolve => { resume = () => resolve([record]); }));
    const api = await import('@/api/plannerClient');
    const network = api.listPlannerItems('task');
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(await api.readCachedPlannerItems('task')).toEqual([task]);
    resume(); await network;
  });
  it('coalesces concurrent launch/resume/pull requests and rate-limits automatic resumes', async () => {
    const api = await import('@/api/plannerClient');
    await Promise.all([api.refreshPlannerData(), api.refreshPlannerData(), api.refreshPlannerData(true)]);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(api.getPlannerSyncState()).toMatchObject({ syncing: false, error: null });
    expect(api.getPlannerSyncState().lastSyncedAt).toBeTypeOf('number');
    await api.refreshPlannerData();
    expect(mocks.request).toHaveBeenCalledTimes(3);
    await api.refreshPlannerData(true);
    expect(mocks.request).toHaveBeenCalledTimes(6);
  });
  it('deduplicates overlapping reads of one record kind', async () => {
    const api = await import('@/api/plannerClient');
    await Promise.all([api.listPlannerItems('task'), api.listPlannerItems('task')]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('does not publish unchanged caches or trigger a widget/notification rebuild', async () => {
    const api = await import('@/api/plannerClient');
    await api.listPlannerItems('task');
    mocks.write.mockClear();
    const changed = vi.fn(); api.onPlannerDataChanged(changed);
    await api.listPlannerItems('task');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
  it('keeps the last successful cloud timestamp when one kind fails', async () => {
    mocks.data.nw_cloud_sync = { lastSyncedAt: 100 };
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('reminder')) throw new Error('Offline');
      return path.endsWith('task') ? [record] : [];
    });
    const api = await import('@/api/plannerClient');
    await api.refreshPlannerData(true);
    expect(api.getPlannerSyncState()).toMatchObject({ syncing: false, lastSyncedAt: 100, error: expect.any(String) });
    expect(mocks.data.nw_cloud_sync).toEqual({ lastSyncedAt: 100, error: true });
  });
  it('commits a widget completion and durable outbox without waiting for a server', async () => {
    const api = await import('@/api/plannerClient');
    const result = await api.updatePlannerItem('task', 7, { completed: true }, {
      userId: 'u1', revision: 2, date: task.dueDate, time: '',
    }, true);
    expect(result).toMatchObject({ completed: true, _pending: true });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.data.nw_sync_outbox).toHaveLength(1);
  });
  it.each([401, 403, 408, 429])('retains offline edits after a retryable %i response', async status => {
    mocks.data.nw_sync_outbox = [{ method: 'PUT', kind: 'task', recordId: 7, body: {} }];
    mocks.request.mockRejectedValue(Object.assign(new Error('Retry later'), { status }));
    const api = await import('@/api/plannerClient');
    expect(await api.flushOutbox()).toBe(1);
    expect(mocks.data.nw_sync_outbox).toHaveLength(1);
  });
  it('does not overwrite an offline completion when flushing cannot reach the server', async () => {
    const api = await import('@/api/plannerClient');
    await api.updatePlannerItem('task', 7, { completed: true }, undefined, true);
    mocks.request.mockRejectedValue(new Error('Offline'));
    await api.listPlannerItems('task');
    expect(mocks.data.nw_tasks).toEqual([expect.objectContaining({ completed: true, _pending: true })]);
    expect(mocks.data.nw_sync_outbox).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('never publishes a late cloud refresh into the next account', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    mocks.request.mockImplementation(async () => { await gate; return [record]; });
    const api = await import('@/api/plannerClient');
    const refresh = api.refreshPlannerData(true);
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    mocks.uid = 'u2'; resume(); await refresh;
    expect(mocks.write).not.toHaveBeenCalled();
    expect(api.getPlannerSyncState()).toMatchObject({ lastSyncedAt: null, error: null });
  });
  it('keeps a conflicting offline edit for review instead of silently deleting it', async () => {
    const api = await import('@/api/plannerClient');
    await api.updatePlannerItem('task', 7, { completed: true }, undefined, true);
    mocks.request.mockRejectedValue(Object.assign(new Error('Changed on another device'), { status: 409 }));
    expect(await api.flushOutbox()).toBe(0);
    expect(await api.getPlannerSyncConflicts()).toEqual([expect.objectContaining({
      recordId: 7, status: 409, content: expect.objectContaining({ completed: true }),
    })]);
    mocks.request.mockImplementation(async (path: string) => path.endsWith('task') ? [record] : []);
    await api.refreshPlannerData(true);
    expect(api.getPlannerSyncState().error).toContain('review');
    expect(mocks.data.nw_tasks).toEqual([expect.objectContaining({ completed: false })]);
  });
  it('archives conflicts while continuing independent queued edits', async () => {
    mocks.data.nw_sync_outbox = [
      { method: 'PUT', kind: 'task', recordId: 7, body: { idempotency_key: 'conflict', content: { title: 'Local' } } },
      { method: 'PUT', kind: 'task', recordId: 8, body: {} },
    ];
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/7')) throw Object.assign(new Error('Conflict'), { status: 409 });
      return { ...record, record_id: '8', revision: 3 };
    });
    const api = await import('@/api/plannerClient');
    expect(await api.flushOutbox()).toBe(0);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(await api.getPlannerSyncConflicts()).toHaveLength(1);
    await api.dismissPlannerSyncConflict('conflict');
    expect(await api.getPlannerSyncConflicts()).toEqual([]);
  });

});
