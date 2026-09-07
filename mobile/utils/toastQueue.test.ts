import { describe, expect, it } from 'vitest';
import { current, dismiss, enqueue, makeToast, ERROR_DURATION, DEFAULT_DURATION } from './toastQueue';

const toast = (message: string, kind: 'success' | 'error' | 'info' = 'info') =>
  makeToast(message, kind);

describe('which toast is on screen', () => {
  it('shows the first one queued', () => {
    const queue = enqueue(enqueue([], toast('Saved')), toast('Deleted'));
    expect(current(queue)?.message).toBe('Saved');
  });

  it('shows nothing when the queue is empty', () => {
    expect(current([])).toBeNull();
  });

  it('does not say the same thing twice from a double tap', () => {
    const first = enqueue([], toast('Saved', 'success'));
    const again = enqueue(first, toast('Saved', 'success'));
    expect(again).toHaveLength(1);
  });

  it('treats the same words at a different severity as a different message', () => {
    const queue = enqueue(enqueue([], toast('Saved', 'success')), toast('Saved', 'error'));
    expect(queue).toHaveLength(2);
  });

  it('drops the oldest in a burst, because the newest is what just happened', () => {
    let queue: ReturnType<typeof toast>[] = [];
    for (const message of ['one', 'two', 'three', 'four']) queue = enqueue(queue, toast(message));
    expect(queue.map(item => item.message)).toEqual(['two', 'three', 'four']);
  });

  it('ignores an empty message rather than flashing a blank bar', () => {
    expect(enqueue([], toast('   '))).toEqual([]);
  });
});

describe('dismissing', () => {
  it('removes the one dismissed', () => {
    const one = toast('Saved');
    expect(dismiss(enqueue([], one), one.id)).toEqual([]);
  });

  it('ignores an id that is no longer queued', () => {
    // A timer firing after a manual dismissal must not remove whatever replaced it.
    const kept = enqueue([], toast('Still here'));
    expect(dismiss(kept, 'a-toast-that-already-went')).toEqual(kept);
  });
});

describe('how long it stays', () => {
  it('holds an error longer, because it is read rather than glanced at', () => {
    expect(toast('Could not save', 'error').duration).toBe(ERROR_DURATION);
    expect(toast('Saved', 'success').duration).toBe(DEFAULT_DURATION);
  });

  it('lets a caller override, including a toast that waits to be dismissed', () => {
    expect(makeToast('Undo?', 'info', 0).duration).toBe(0);
  });
});
