// Parsing for the free-text time fields on tasks and reminders.
//
// The backend pins both due_time and time to ^([01]\d|2[0-3]):[0-5]\d$, so
// "9:30" is rejected with a raw 422 that says nothing a student can act on.
// Web never hits this because it uses <input type="time">, which always emits
// HH:MM; React Native has no equivalent, so the checking happens here.
//
// Pure, so the accepted and rejected shapes are tested rather than discovered
// by a failed save.

/** The exact pattern the API enforces. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ParsedTime {
  /** Canonical HH:MM, or null when no time was given. */
  value: string | null;
  /** A message to show under the field, or null when the input is usable. */
  error: string | null;
}

const OK = (value: string | null): ParsedTime => ({ value, error: null });
const BAD = (error: string): ParsedTime => ({ value: null, error });

function build(hours: string, minutes: string): ParsedTime {
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 23) return BAD('Hour must be between 00 and 23.');
  if (m > 59) return BAD('Minutes must be between 00 and 59.');
  return OK(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

/**
 * Read what the user typed into something the API will accept.
 *
 * Blank is a valid answer — a task or reminder need not have a time — so it
 * returns null rather than an error. A single-digit hour and a bare "930" are
 * both accepted and padded, because they are what people actually type on a
 * phone, not mistakes worth refusing.
 */
export function parseTimeInput(raw: string | null | undefined): ParsedTime {
  const text = String(raw ?? '').trim();
  if (!text) return OK(null);

  const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (colon) return build(colon[1], colon[2]);

  const digits = /^(\d{1,2})(\d{2})$/.exec(text);
  if (digits) return build(digits[1], digits[2]);

  return BAD('Use 24-hour HH:MM, for example 09:30 or 14:00.');
}

/** True when the field can be saved as it stands. */
export function isTimeInputUsable(raw: string | null | undefined): boolean {
  return parseTimeInput(raw).error === null;
}
