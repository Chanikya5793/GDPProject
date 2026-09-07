// Turning link parameters into something safe to seed a form with.
//
// The values arrive from outside the app — Siri dictation, a widget tap, the
// Shortcuts app, or anything else that can open a URL — so they are treated as
// untrusted input rather than as a record. Kept pure and apart from the screens
// because the awkward cases are all here: a repeated parameter, a phrase long
// enough to be a paragraph, control characters from a bad encoder, a date in a
// shape nothing stores, a priority that is not one of the three, and a link
// with no text at all, which should open the form empty rather than not at all.

import { Task } from '@/types';

/** A title longer than this is a paragraph, and no screen shows it whole. */
export const MAX_DRAFT_LENGTH = 120;

/** Notes get more room than a title, but not unbounded. */
export const MAX_NOTES_LENGTH = 500;

export interface LinkDraft {
  title: string;
  /** `YYYY-MM-DD`, or '' when the link named no day. */
  date: string;
  /** `HH:MM`, or '' when the link named no time. */
  time: string;
  priority: Task['priority'] | '';
  category: string;
  notes: string;
}

export const EMPTY_DRAFT: LinkDraft = {
  title: '', date: '', time: '', priority: '', category: '', notes: '',
};

type Param = string | string[] | undefined;

/** Repeated parameters arrive as an array; the first wins, because a link with
 *  two titles has no better answer and picking one beats refusing. */
function first(value: Param): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

function clean(value: string, limit: number): string {
  // Newlines and control characters break a single-line field, and dictation
  // produces them happily.
  const collapsed = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? collapsed.slice(0, limit).trimEnd() : collapsed;
}

/**
 * The title to seed a new record with, or '' when the link carries none.
 */
export function draftFromLink(value: Param): string {
  const raw = first(value);
  return raw === undefined ? '' : clean(raw, MAX_DRAFT_LENGTH);
}

/**
 * Whether a link asked for the create form at all.
 *
 * Distinct from the title being empty: `?new=` with nothing after it is still a
 * request to start something new, and should open the form ready to type in.
 */
export function wantsNewRecord(value: Param): boolean {
  return first(value) !== undefined;
}

/**
 * Everything a link had to say about a new record.
 *
 * Anything malformed is dropped rather than rejected. A voice command that got
 * the priority wrong should still create the task — the student is looking at
 * the form and can fix it — where refusing the whole link would lose the title
 * they just dictated.
 */
export function fullDraftFromLink(params: Record<string, Param>): LinkDraft {
  const day = first(params.due) || '';
  const clock = first(params.at) || '';
  const priority = (first(params.priority) || '').toLowerCase();
  const category = first(params.category) || '';

  return {
    title: draftFromLink(params.new),
    date: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : '',
    priority: priority === 'high' || priority === 'medium' || priority === 'low'
      ? priority
      : '',
    category: clean(category, 40),
    notes: clean(first(params.notes) || '', MAX_NOTES_LENGTH),
  };
}

/**
 * The record a link asked to scroll to, or ''.
 *
 * Ids reach here from a widget tap. They are compared against records the app
 * already has rather than looked up, so an unknown one simply highlights
 * nothing.
 */
export function focusFromLink(value: Param): string {
  const raw = first(value);
  return raw === undefined ? '' : raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}
