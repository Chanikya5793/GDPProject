import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uid: null as string | null,
  scopeChanged: () => {},
  records: {} as Record<string, unknown>,
  commands: [] as Record<string, unknown>[],
  publish: vi.fn(), clear: vi.fn(), claim: vi.fn(), acknowledge: vi.fn(), update: vi.fn(), log: vi.fn(),
  read: vi.fn(),
  os: 'ios' as 'ios' | 'android' | 'web',
  androidModule: true,
}));
// The same fake bridge stands in for the iOS native module and the Android
// Expo module, which share one contract.
const bridge = () => ({
  publish: mocks.publish, clear: mocks.clear, claim: mocks.claim, acknowledge: mocks.acknowledge,
  pendingCount: async () => mocks.commands.length,
});
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.os; } },
  NativeModules: { get PlannerWidgetsBridge() { return mocks.os === 'ios' ? bridge() : undefined; } },
}));
vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mocks.os === 'android' && mocks.androidModule && name === 'PlannerWidgetsBridge' ? bridge() : null,
}));
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
  mocks.os = 'ios';
  mocks.androidModule = true;
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

describe('widget titles', () => {
  const published = () => JSON.parse(mocks.publish.mock.calls.at(-1)![0]);
  it('publishes titles when nothing about them was ever saved', async () => {
    mocks.uid = 'u1';
    mocks.records.nw_settings = {};
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(published().titlesAllowed).toBe(true);
    expect(published().items[0].title).toBe('Assignment');
  });
  it('publishes titles for an install carrying the old default it never chose', async () => {
    mocks.uid = 'u1';
    mocks.records.nw_settings = { widgetShowTitles: false };
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(published().titlesAllowed).toBe(true);
  });
  it('withholds titles when the student switched them off', async () => {
    mocks.uid = 'u1';
    mocks.records.nw_settings = { widgetShowTitles: false, widgetTitlesDecided: true };
    const api = await import('@/api/widgets');
    await api.syncWidget();
    expect(published().titlesAllowed).toBe(false);
    expect(published().items[0].title).toBe('');
  });
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

describe('platform bridges', () => {
  it('publishes through the Android widget module', async () => {
    mocks.os = 'android'; mocks.uid = 'u1';
    const api = await import('@/api/widgets');
    expect(api.nativeWidgetsAvailable()).toBe(true);
    expect(await api.syncWidget()).toBe(1);
    expect(JSON.parse(mocks.publish.mock.calls[0][0]).items[0].title).toBe('Assignment');
  });
  it('applies taps queued on an Android widget', async () => {
    mocks.os = 'android'; mocks.uid = 'u1'; mocks.commands = [{ ...action }];
    const api = await import('@/api/widgets');
    await api.syncPendingWidgetActions();
    expect(mocks.update).toHaveBeenCalledWith('task', 7, { completed: true },
      { userId: 'u1', revision: 2, date: '2026-09-17', time: '' });
    expect(mocks.commands).toHaveLength(0);
  });
  it('does nothing on an Android build without the module', async () => {
    mocks.os = 'android'; mocks.uid = 'u1'; mocks.androidModule = false;
    const api = await import('@/api/widgets');
    expect(api.nativeWidgetsAvailable()).toBe(false);
    expect(await api.syncWidget()).toBe(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('does nothing on the web', async () => {
    mocks.os = 'web'; mocks.uid = 'u1';
    const api = await import('@/api/widgets');
    expect(await api.syncWidget()).toBe(0);
  });
});
