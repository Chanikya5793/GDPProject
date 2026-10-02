// Only @nwmissouri.edu accounts may register, so the sign-in form takes a bare
// S number or employee username and fills in the domain. Students sign in as
// s123456@nwmissouri.edu, staff as name@nwmissouri.edu. Mirrors
// src/utils/campusEmail.js.

export const CAMPUS_DOMAIN = 'nwmissouri.edu';

/**
 * The full address for what was typed: an S number, a bare student ID, a staff
 * username, or an address already complete (returned trimmed and lower-cased).
 */
export function campusEmail(input: string | null | undefined): string {
  const typed = String(input || '').trim().toLowerCase();
  if (!typed) return '';
  // A full address stays as typed so the sign-up policy can still refuse it;
  // only a lone trailing "@" ("s123456@") is completed.
  if (typed.includes('@') && !/^[^@]+@$/.test(typed)) return typed;
  const name = typed.replace(/@$/, '');
  // "123456" and "S123456" are the same student.
  const local = /^s?\d+$/.test(name) ? `s${name.replace(/^s/, '')}` : name;
  return `${local}@${CAMPUS_DOMAIN}`;
}
