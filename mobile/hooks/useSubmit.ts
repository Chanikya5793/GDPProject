import { useEffect, useRef, useState } from 'react';

import { BUSY_LOOK_DELAY_MS, createSubmitGuard } from '@/utils/submitGuard';

/**
 * Runs a form's save once at a time and keeps its error for the form to show.
 * `showBusy` turns on only once a save outlasts BUSY_LOOK_DELAY_MS.
 */
export function useSubmit() {
  const guard = useRef(createSubmitGuard()).current;
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!busy) {
      setShowBusy(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowBusy(true), BUSY_LOOK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const submit = async (save: () => Promise<unknown> | unknown) => {
    if (guard.inFlight) return;
    setBusy(true);
    setError('');
    const result = await guard.run(save);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok && 'error' in result) setError(result.error);
  };

  return { submit, busy, showBusy, error, setError };
}
