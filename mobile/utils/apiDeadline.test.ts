import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ firebaseConfigured: true, auth: { currentUser: { uid: 'u1', getIdToken: mocks.token } } }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubEnv('EXPO_PUBLIC_PLANNER_API_URL', 'https://example.invalid');
  mocks.token.mockReset().mockResolvedValue('synthetic-test-token');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('planner request deadlines', () => {
  it('bounds a stalled Firebase token refresh and never sends after its deadline', async () => {
    let resolve!: (value: string) => void;
    mocks.token.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
    const { apiRequest } = await import('@/api/client');
    const request = apiRequest('/v1/records/task');
    const rejected = expect(request).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    resolve('synthetic-test-token'); await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds reading a response body after headers arrive', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => {}) } as Response);
    const { apiRequest } = await import('@/api/client');
    const rejected = expect(apiRequest('/v1/records/task')).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('honors the deadline even when the caller supplies its own signal', async () => {
    const caller = new AbortController();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const { apiRequest } = await import('@/api/client');
    const rejected = expect(apiRequest('/v1/records/task', { signal: caller.signal })).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('propagates cancellation while waiting for authentication', async () => {
    mocks.token.mockImplementation(() => new Promise(() => {}));
    const caller = new AbortController();
    const { apiRequest } = await import('@/api/client');
    const rejected = expect(apiRequest('/v1/records/task', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort(); await rejected;
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects malformed JSON instead of returning an empty record set', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 200, ok: true, json: async () => { throw new SyntaxError('Malformed JSON'); } } as unknown as Response);
    const { apiRequest } = await import('@/api/client');
    await expect(apiRequest('/v1/records/task')).rejects.toThrow('Malformed JSON');
    expect(vi.getTimerCount()).toBe(0);
  });
});
