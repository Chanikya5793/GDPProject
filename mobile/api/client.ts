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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!firebaseConfigured || !API_URL) throw new ApiError('Planner cloud service is not configured.', 503, 'not_configured');
  if (!auth?.currentUser) throw new ApiError('Sign in is required.', 401, 'unauthenticated');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.detail || 'Planner request failed.', response.status, payload.code);
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
