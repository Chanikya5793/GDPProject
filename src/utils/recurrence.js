// How a repeat reads on a row, given the rule the server stored with it.
//
// A series is written out as one record per date, so a row is an ordinary task
// or reminder and looks like every other one. Without this the only way to tell
// the thirteenth Friday from a one-off is to notice twelve siblings elsewhere
// in the list.

const EVERY = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const UNITS = { daily: 'days', weekly: 'weeks', monthly: 'months' }

/**
 * A short label for a repeat, or null when a record does not have one.
 *
 * Null rather than an empty string so a caller renders nothing at all instead
 * of an empty badge, which reads as a rendering bug.
 */
export function recurrenceLabel(recurrence) {
  const frequency = recurrence?.frequency
  if (!frequency || !UNITS[frequency]) return null
  const interval = Number(recurrence.interval) || 1
  if (interval === 1) return EVERY[frequency]
  return `Every ${interval} ${UNITS[frequency]}`
}

/** The same label with how many are in the series, for a tooltip. */
export function recurrenceDetail(recurrence) {
  const label = recurrenceLabel(recurrence)
  if (!label) return null
  const count = Number(recurrence.count) || 0
  return count > 1 ? `${label} · ${count} in this series` : label
}
