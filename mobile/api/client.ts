import { auth, firebaseConfigured } from '@/lib/firebase';
import { EventStreamError, readEventStream } from '@/utils/eventStream';
import { SseEvent } from '@/utils/sse';

const API_URL = (process.env.EXPO_PUBLIC_PLANNER_API_URL || '').replace(/\/$/, '');

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

/**
 * Ask the API for nothing in particular, early, so it is awake when needed.
 *
 * The service scales to zero to avoid paying for an idle instance, which puts
 * a container start in front of whoever asks first. Calling this as the app
 * mounts, and again when it returns from the background, moves that start
 * into the seconds spent on the splash screen rather than into the first
 * real request.
 *
 * Deliberately silent and unawaited: it is an optimisation, and a warm-up
 * that failed must never surface as an error or block anything.
 */
export function warmUpApi(): void {
  if (!apiConfigured()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  fetch(`${API_URL}/v1/signup-policy`, { method: 'GET', signal: controller.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!firebaseConfigured || !API_URL) throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured');
  if (!auth?.currentUser) throw new ApiError('Sign in is required.', 401, 'unauthenticated');
  const token = await auth.currentUser.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // No status on purpose: the callers treat a status-less error as "the
      // server was unreachable" and keep the change for later.
      throw new Error('The planner service took too long to answer. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(describeDetail(payload.detail, response.status), response.status, payload.code);
  return payload as T;
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
