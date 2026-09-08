// Which toast is on screen, and what happens to the ones behind it.
//
// Kept apart from the component because this is the part with rules: a second
// message arriving while one is showing, the same message firing twice from a
// double tap, and a dismissal racing the timer that was going to dismiss it.
// The mobile suite runs pure functions only, so logic left inside the component
// is logic nothing can test.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  /** Milliseconds on screen. 0 means it waits to be dismissed. */
  duration: number;
}

export const DEFAULT_DURATION = 3200;

/** Longer for errors: they are read, not glanced at, and often name a fix. */
export const ERROR_DURATION = 5000;

export function makeToast(
  message: string,
  kind: ToastKind = 'info',
  duration?: number,
): Toast {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: message.trim(),
    kind,
    duration: duration ?? (kind === 'error' ? ERROR_DURATION : DEFAULT_DURATION),
  };
}

/**
 * The queue after a new toast arrives.
 *
 * An identical message already waiting is not queued again, so a double tap on
 * Confirm does not say "Saved" twice. The queue is capped because a burst — a
 * batch of changes each reporting itself — would otherwise take half a minute
 * to drain and long outlive the action that caused it.
 */
export function enqueue(queue: Toast[], toast: Toast, limit = 3): Toast[] {
  if (!toast.message) return queue;
  if (queue.some(item => item.message === toast.message && item.kind === toast.kind)) {
    return queue;
  }
  const next = [...queue, toast];
  // Drops from the front: the newest message is the one about what just
  // happened, so it is the one worth keeping.
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The queue after a toast is dismissed. Unknown ids are ignored, so a timer
 *  firing after a manual dismissal cannot remove the message that replaced it. */
export function dismiss(queue: Toast[], id: string): Toast[] {
  return queue.filter(item => item.id !== id);
}

/** What should be on screen: the oldest still waiting, or nothing. */
export function current(queue: Toast[]): Toast | null {
  return queue[0] ?? null;
}
