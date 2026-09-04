// How a repeat reads on a row, given the rule the server stored with it.
//
// A series is written out as one record per date, so a row is an ordinary task
// or reminder and looks like every other one. Without this the only way to tell
// the thirteenth Friday from a one-off is to notice twelve siblings elsewhere
// in the list.

export interface Recurrence {
  frequency: string;
  interval: number;
  count: number;
}

const EVERY: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const UNITS: Record<string, string> = { daily: 'days', weekly: 'weeks', monthly: 'months' };

/**
 * A short label for a repeat, or null when a record does not have one.
 *
 * Null rather than an empty string so a caller renders nothing at all instead
 * of an empty chip, which reads as a rendering bug.
 */
export function recurrenceLabel(recurrence?: Recurrence | null): string | null {
  const frequency = recurrence?.frequency;
  if (!frequency || !UNITS[frequency]) return null;
  const interval = Number(recurrence?.interval) || 1;
  if (interval === 1) return EVERY[frequency];
  return `Every ${interval} ${UNITS[frequency]}`;
}
