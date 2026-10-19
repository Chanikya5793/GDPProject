import { describe, expect, it } from 'vitest';

import { createSubmitGuard } from './submitGuard';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => { resolve = res; });
  return { promise, resolve };
}

describe('createSubmitGuard', () => {
  it('saves once however fast the button is tapped', async () => {
    const guard = createSubmitGuard();
    const pending = deferred();
    let calls = 0;
    const save = () => { calls += 1; return pending.promise; };
    const first = guard.run(save);
    const second = guard.run(save);
    const third = guard.run(save);
    expect(calls).toBe(1);
    expect(await second).toEqual({ ok: false, skipped: true });
    expect(await third).toEqual({ ok: false, skipped: true });
    pending.resolve();
    expect(await first).toEqual({ ok: true });
  });

  it('hands back the reason a save failed and allows a retry', async () => {
    const guard = createSubmitGuard();
    expect(await guard.run(() => { throw new Error('You are offline.'); }))
      .toEqual({ ok: false, error: 'You are offline.' });
    expect(guard.inFlight).toBe(false);
    expect(await guard.run(async () => {})).toEqual({ ok: true });
  });

  it('falls back to a plain message when the error has none', async () => {
    const guard = createSubmitGuard();
    expect(await guard.run(() => Promise.reject('nope')))
      .toEqual({ ok: false, error: 'Something went wrong. Try again.' });
  });
});
