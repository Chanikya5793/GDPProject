import { auth, firebaseConfigured } from '@/lib/firebase';
import { EventStreamError, readEventStream } from '@/utils/eventStream';
import { SseEvent } from '@/utils/sse';

export const API_URL = (process.env.EXPO_PUBLIC_PLANNER_API_URL || '').replace(/\/$/, '');

/** True when a real backend is reachable; the offline demo build has none. */
export function apiConfigured(): boolean {
  return firebaseConfigured && Boolean(API_URL);
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// A request that never answers used to hang the create or update behind it
// with the outbox never engaged; React Native's fetch sets no limit of its own.
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A validation failure arrives as a list of {loc, msg} entries, and a list
 * interpolated into a message reads as "[object Object]". Name the first
 * field and what was wrong with it; that is what the student can act on.
 */
export function describeDetail(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { loc?: unknown[]; msg?: string };
    const where = (first.loc || [])
      .filter((part): part is string => typeof part === 'string' && part !== 'body')
      .join('.');
    const message = first.msg || 'is invalid';
    const rest = detail.length > 1 ? ` (and ${detail.length - 1} more)` : '';
    return where ? `${where}: ${message}${rest}` : `${message}${rest}`;
  }
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message;
  }
  return `Planner request failed (${status})`;
}

/** Names this running app in the backend's change marker, so the live
 * listener can skip the echo of our own writes. Per launch is enough. */
export const CLIENT_ID = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!firebaseConfigured || !API_URL) throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured');
  if (!auth?.currentUser) throw new ApiError('Sign in is required.', 401, 'unauthenticated');
  const user = auth.currentUser;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('The planner service took too long to answer. Your saved data is still available.'));
    }, REQUEST_TIMEOUT_MS);
    cancel = () => {
      controller.abort();
      reject(Object.assign(new Error('Planner request cancelled.'), { name: 'AbortError' }));
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
  });
  const request = async (): Promise<T> => {
    // The deadline covers Firebase token refresh and reading the response body,
    // not just fetching headers. A stalled token used to bypass the timeout.
    const token = await user.getIdToken();
    if (controller.signal.aborted) throw new Error('Planner request cancelled.');
    if (auth?.currentUser?.uid !== user.uid) throw new ApiError('Account changed.', 401);
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Planner-Client': CLIENT_ID,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json();
    if (!response.ok) throw new ApiError(describeDetail(payload.detail, response.status), response.status, payload.code);
    return payload as T;
  };
  try { return await Promise.race([deadline, request()]); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


/**
 * POST to a Server-Sent Events endpoint, calling onEvent for each event.
 *
 * The reading itself lives in utils/eventStream so it can be tested against a
 * fake transport; this only supplies auth and a real XMLHttpRequest.
 */
export async function apiStream(
  path: string,
  options: { body?: string; signal?: AbortSignal },
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!firebaseConfigured || !API_URL) throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured');
  if (!auth?.currentUser) throw new ApiError('Sign in is required.', 401, 'unauthenticated');
  const token = await auth.currentUser.getIdToken();
  try {
    await readEventStream(new XMLHttpRequest(), {
      url: `${API_URL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: options.body,
      signal: options.signal,
    }, onEvent);
  } catch (error) {
    if (error instanceof EventStreamError) throw new ApiError(error.message, error.status, error.code);
    throw error;
  }
}
