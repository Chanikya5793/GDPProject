// One save at a time for a form, with a short grace period before it looks busy.

/**
 * Saves that finish faster than this never show the busy look: flashing a
 * spinner (or a grayed button) for a few milliseconds reads as lag.
 */
export const BUSY_LOOK_DELAY_MS = 200;

export type SubmitResult = { ok: true } | { ok: false; error: string } | { ok: false; skipped: true };

/**
 * Runs a save unless one is already running. The flag is plain state outside
 * React, so a second tap that lands before the re-render is still refused.
 */
export function createSubmitGuard() {
  let inFlight = false;
  return {
    get inFlight() { return inFlight; },
    async run(save: () => Promise<unknown> | unknown): Promise<SubmitResult> {
      if (inFlight) return { ok: false, skipped: true };
      inFlight = true;
      try {
        await save();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return { ok: false, error: message || 'Something went wrong. Try again.' };
      } finally {
        inFlight = false;
      }
    },
  };
}
