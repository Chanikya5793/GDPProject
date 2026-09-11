import { describe, expect, it } from 'vitest';
import {
  contextFromLink,
  draftFromLink,
  EMPTY_DRAFT,
  focusFromLink,
  fullDraftFromLink,
  MAX_DRAFT_LENGTH,
  MAX_NOTES_LENGTH,
  wantsNewRecord,
} from './draftFromLink';

describe('draftFromLink', () => {
  it('passes an ordinary dictated phrase through', () => {
    expect(draftFromLink('Finish the lab report')).toBe('Finish the lab report');
  });

  it('collapses the whitespace and control characters dictation produces', () => {
    expect(draftFromLink('  Read \n chapter\t\t4 ')).toBe('Read chapter 4');
    expect(draftFromLink('Essay  draft')).toBe('Essay draft');
  });

  it('caps a phrase long enough to be a paragraph', () => {
    const result = draftFromLink('word '.repeat(80));
    expect(result.length).toBeLessThanOrEqual(MAX_DRAFT_LENGTH);
    expect(result.endsWith(' ')).toBe(false);
  });

  it('takes the first of a repeated parameter rather than refusing', () => {
    expect(draftFromLink(['First', 'Second'])).toBe('First');
  });

  it('returns nothing for a missing or blank parameter', () => {
    expect(draftFromLink(undefined)).toBe('');
    expect(draftFromLink('   ')).toBe('');
    expect(draftFromLink([])).toBe('');
  });
});

describe('wantsNewRecord', () => {
  it('separates "open the form empty" from "no request at all"', () => {
    expect(wantsNewRecord('')).toBe(true);
    expect(wantsNewRecord('Essay')).toBe(true);
    expect(wantsNewRecord(undefined)).toBe(false);
  });
});

describe('fullDraftFromLink', () => {
  it('reads everything a Siri command can carry', () => {
    expect(fullDraftFromLink({
      new: 'Lab report',
      due: '2026-09-09',
      at: '17:30',
      priority: 'high',
      category: 'Lab',
      notes: 'Bring the printed graphs',
    })).toEqual({
      title: 'Lab report',
      date: '2026-09-09',
      time: '17:30',
      priority: 'high',
      category: 'Lab',
      notes: 'Bring the printed graphs',
    });
  });

  it('returns an empty draft when the link carried nothing', () => {
    expect(fullDraftFromLink({})).toEqual(EMPTY_DRAFT);
  });

  it('keeps the title when a companion value is malformed', () => {
    const draft = fullDraftFromLink({
      new: 'Lab report', due: 'next tuesday', at: '5pm', priority: 'urgent',
    });
    expect(draft.title).toBe('Lab report');
    expect(draft.date).toBe('');
    expect(draft.time).toBe('');
    expect(draft.priority).toBe('');
  });

  it('accepts only the three real priorities, case-insensitively', () => {
    expect(fullDraftFromLink({ priority: 'HIGH' }).priority).toBe('high');
    expect(fullDraftFromLink({ priority: 'Medium' }).priority).toBe('medium');
    expect(fullDraftFromLink({ priority: 'low' }).priority).toBe('low');
    expect(fullDraftFromLink({ priority: 'critical' }).priority).toBe('');
  });

  it('rejects a time that is not a real clock reading', () => {
    expect(fullDraftFromLink({ at: '24:00' }).time).toBe('');
    expect(fullDraftFromLink({ at: '09:60' }).time).toBe('');
    expect(fullDraftFromLink({ at: '09:05' }).time).toBe('09:05');
  });

  it('caps notes without discarding them', () => {
    const notes = fullDraftFromLink({ notes: 'x'.repeat(900) }).notes;
    expect(notes.length).toBe(MAX_NOTES_LENGTH);
  });
});

describe('focusFromLink', () => {
  it('keeps a plain record id', () => {
    expect(focusFromLink('task_12ab-34')).toBe('task_12ab-34');
  });

  it('strips anything that is not an id and bounds the length', () => {
    expect(focusFromLink('../../etc/passwd')).toBe('etcpasswd');
    expect(focusFromLink('a'.repeat(200)).length).toBe(64);
    expect(focusFromLink(undefined)).toBe('');
  });
});

describe('contextFromLink', () => {
  it('reads a record handed over by an Ask AI tap', () => {
    expect(contextFromLink({ about: 'task_12', kind: 'task', title: 'Lab report' })).toEqual({
      id: 'task_12', kind: 'task', title: 'Lab report', approvedForAi: true,
    });
  });

  it('sanitises the id the same way a focus link is sanitised', () => {
    expect(contextFromLink({ about: '../../etc/passwd', kind: 'note', title: 'x' })?.id)
      .toBe('etcpasswd');
    expect(contextFromLink({ about: 'a'.repeat(200), kind: 'note', title: 'x' })?.id.length)
      .toBe(64);
  });

  it('refuses a kind that is not a record type', () => {
    expect(contextFromLink({ about: 'x1', kind: 'schedule', title: 'x' })).toBeNull();
    expect(contextFromLink({ about: 'x1', kind: 'wat', title: 'x' })).toBeNull();
  });

  it('is null without a record to point at', () => {
    expect(contextFromLink({ kind: 'task', title: 'Lab report' })).toBeNull();
    expect(contextFromLink({})).toBeNull();
  });

  it('cleans and caps the title, which is only ever shown on a chip', () => {
    const title = contextFromLink({
      about: 't1', kind: 'task', title: 'Lab  report\nwith a newline',
    })?.title;
    expect(title).toBe('Lab report with a newline');
  });

  it('treats a missing approval flag as approved, and only "false" as not', () => {
    expect(contextFromLink({ about: 't1', kind: 'task', title: 'x' })?.approvedForAi).toBe(true);
    expect(contextFromLink({ about: 't1', kind: 'task', title: 'x', approved: 'false' })?.approvedForAi)
      .toBe(false);
  });
});
