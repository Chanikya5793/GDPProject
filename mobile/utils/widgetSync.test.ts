import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uid: null as string | null,
  scopeChanged: () => {},
  records: {} as Record<string, unknown>,
  commands: [] as Record<string, unknown>[],
  publish: vi.fn(), clear: vi.fn(), claim: vi.fn(), acknowledge: vi.fn(), update: vi.fn(), log: vi.fn(),
  read: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: { PlannerWidgetsBridge: {
  publish: mocks.publish, clear: mocks.clear, claim: mocks.claim, acknowledge: mocks.acknowledge,
  pendingCount: async () => mocks.commands.length,
} } }));
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_: string, value: string) => `hash:${value}` }));
vi.mock('@/api/storage', () => ({ getStorageUid: () => mocks.uid, getItem: mocks.read,
  onStorageScopeChange: (listener: () => void) => { mocks.scopeChanged = listener; return () => {}; } }));
vi.mock('@/api/plannerClient', () => ({ updatePlannerItem: mocks.update }));
vi.mock('@/api/logs', () => ({ addLog: mocks.log }));

const task = { id: 7, userId: 'u1', title: 'Assignment', dueDate: '2026-09-17', dueTime: '',
  category: 'Homework', priority: 'high', notes: '', completed: false, _revision: 2 };
const action = { id: 'action', owner: 'hash:planner-widgets:u1', kind: 'task', recordId: '7',
  revision: 2, date: '2026-09-17', time: '', createdAt: 1 };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.uid = null;
  mocks.records = { nw_tasks: [{ ...task }], nw_reminders: [], nw_settings: { widgetShowTitles: true } };
  mocks.commands = [];
  mocks.publish.mockResolvedValue(undefined);
  mocks.clear.mockImplementation(async () => { mocks.commands = []; });
  mocks.claim.mockImplementation(async () => JSON.stringify(mocks.commands));
  mocks.acknowledge.mockImplementation(async (_: string, id: string) => { mocks.commands = mocks.commands.filter(c => c.id !== id); });
  mocks.read.mockImplementation(async (key: string, fallback: unknown) => mocks.records[key] ?? fallback);
  mocks.update.mockImplementation(async () => {
    const completed = { ...task, completed: true };
    mocks.records.nw_tasks = [completed];
    return completed;
  });
  mocks.log.mockResolvedValue('log');
});

describe('native widget sync lifecycle', () => {
  it('preserves and applies taps when the signed-in account restores after a cold launch', async () => {
    const api = await import('@/api/widgets');
    mocks.commands = [{ ...action }];
    mocks.uid = 'u1'; mocks.scopeChanged();
    await api.syncWidget();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith('task', 7, { completed: true },
      { userId: 'u1', revision: 2, date: '2026-09-17', time: '' });
    expect(JSON.parse(mocks.publish.mock.calls[0][0]).items[0].done).toBe(true);
    expect(mocks.commands).toHaveLength(0);
  });
  it('does not publish another user’s cached records', async () => {
    mocks.uid = 'u1';
    mocks.records.nw_tasks = [task, { ...task, id: 'other', userId: 'u2' }];
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(JSON.parse(mocks.publish.mock.calls[0][0]).items).toHaveLength(1);
  });
  it('does not acknowledge a transient failure, so the command can retry', async () => {
    mocks.uid = 'u1'; mocks.commands = [{ ...action }];
    mocks.update.mockRejectedValue(new Error('Keychain temporarily unavailable'));
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(mocks.commands).toHaveLength(1);
  });
  it('removes a conflicting action with a visible explanation', async () => {
    mocks.uid = 'u1'; mocks.commands = [{ ...action }];
    mocks.update.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(mocks.acknowledge).toHaveBeenCalledWith(action.owner, action.id, expect.stringContaining('changed'));
  });
  it('replays a completion without issuing a second mutation', async () => {
    mocks.uid = 'u1'; mocks.commands = [{ ...action }];
    mocks.records.nw_tasks = [{ ...task, completed: true }];
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.commands).toHaveLength(0);
  });
  it('invalidates an in-flight publication on sign-out', async () => {
    mocks.uid = 'u1';
    let resume!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    mocks.read.mockImplementation(async (key: string, fallback: unknown) => {
      await blocked;
      return mocks.records[key] ?? fallback;
    });
    const api = await import('@/api/widgets');
    const syncing = api.syncWidget();
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    mocks.uid = null; mocks.scopeChanged(); resume();
    await syncing;
    await api.clearWidget();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalled();
  });
});
