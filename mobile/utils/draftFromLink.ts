// Turning a `?new=` link parameter into something safe to seed a form with.
//
// The text arrives from outside the app — Siri dictation, the Shortcuts app, or
// anything else that can open a URL — so it is treated as untrusted input
// rather than as a title. Kept pure and apart from the screens because the
// awkward cases are all here: a repeated parameter, a phrase long enough to be
// a paragraph, control characters from a bad encoder, and a link with no text
// at all, which should open the form empty rather than not at all.

/** A title longer than this is a paragraph, and no screen shows it whole. */
export const MAX_DRAFT_LENGTH = 120;

/**
 * The title to seed a new record with, or '' when the link carries none.
 *
 * Repeated parameters arrive as an array; the first is used, because a link
 * with two titles has no better answer and picking one beats refusing.
 */
export function draftFromLink(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  // Newlines and control characters would break a single-line field, and
  // dictation happily produces them.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_DRAFT_LENGTH ? cleaned.slice(0, MAX_DRAFT_LENGTH).trimEnd() : cleaned;
}

/**
 * Whether a link asked for the create form at all.
 *
 * Distinct from the title being empty: `?new=` with nothing after it is still a
 * request to start something new, and should open the form ready to type in.
 */
export function wantsNewRecord(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string';
}
