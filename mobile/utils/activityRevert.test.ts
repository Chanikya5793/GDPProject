import { describe, expect, it } from 'vitest';

import { buildRevertUpdate, canRevert, describeRevert } from './activityRevert';
import { LogEntry } from '@/types';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    ts: '2026-08-25T12:00:00.000Z',
    sessionId: 's_1',
    sessionStart: '2026-08-25T11:00:00.000Z',
    action: 'updated',
    entity: 'task',
    title: 'Write report',
    entityId: 't1',
    ...overrides,
  };
}

describe('buildRevertUpdate', () => {
  it('returns only the fields that changed', () => {
    const before = { title: 'Old', priority: 'low', category: 'Homework' };
    const after = { title: 'New', priority: 'low', category: 'Homework' };
    expect(buildRevertUpdate(before, after)).toEqual({ title: 'Old' });
  });

  it('restores the prior value, not the current one', () => {
    expect(buildRevertUpdate({ priority: 'low' }, { priority: 'high' }))
      .toEqual({ priority: 'low' });
  });

  it('skips identifiers, timestamps, and attachments', () => {
    const before = {
      id: 1, userId: 'u1', createdAt: 'a', updatedAt: 'b',
      attachments: [{ name: 'old.pdf' }], title: 'Old',
    };
    const after = {
      id: 2, userId: 'u2', createdAt: 'c', updatedAt: 'd',
      attachments: [{ name: 'new.pdf' }], title: 'New',
    };
    // Attachment binaries are stripped from snapshots, so "restoring" them
    // would blank them instead.
    expect(buildRevertUpdate(before, after)).toEqual({ title: 'Old' });
  });

  it('compares by value, so equal objects are not treated as changes', () => {
    const before = { tagIds: ['1', '2'] };
    const after = { tagIds: ['1', '2'] };
    expect(buildRevertUpdate(before, after)).toEqual({});
  });

  it('catches a field that only exists on one side', () => {
    expect(buildRevertUpdate({ notes: 'kept' }, {})).toEqual({ notes: 'kept' });
    expect(buildRevertUpdate({}, { notes: 'added' })).toEqual({ notes: undefined });
  });

  it('tolerates null and undefined snapshots', () => {
    expect(buildRevertUpdate(null, null)).toEqual({});
    expect(buildRevertUpdate(undefined, { title: 'New' })).toEqual({ title: undefined });
  });
});

describe('canRevert', () => {
  it('rejects entries already reverted, and revert entries themselves', () => {
    expect(canRevert(entry({ reverted: true, before: { title: 'a' }, after: { title: 'b' } }))).toBe(false);
    expect(canRevert(entry({ action: 'reverted' }))).toBe(false);
  });

  it('rejects entries with no entityId', () => {
    // Written before snapshots existed; there is nothing to target.
    expect(canRevert(entry({ entityId: undefined }))).toBe(false);
  });

  it('allows undoing a creation', () => {
    expect(canRevert(entry({ action: 'created' }))).toBe(true);
  });

  it('allows undoing a deletion only with a trash id or a snapshot', () => {
    expect(canRevert(entry({ action: 'deleted', trashId: 7 }))).toBe(true);
    expect(canRevert(entry({ action: 'deleted', before: { title: 'gone' } }))).toBe(true);
    expect(canRevert(entry({ action: 'deleted' }))).toBe(false);
  });

  it('allows an update only when a restorable field changed', () => {
    expect(canRevert(entry({ before: { title: 'a' }, after: { title: 'b' } }))).toBe(true);
    // Only an attachment changed — nothing this can put back.
    expect(canRevert(entry({
      before: { attachments: [{ name: 'a.pdf' }] },
      after: { attachments: [{ name: 'b.pdf' }] },
    }))).toBe(false);
    // Nothing changed at all.
    expect(canRevert(entry({ before: { title: 'a' }, after: { title: 'a' } }))).toBe(false);
  });

  it('covers completed and reopened the same way as updated', () => {
    for (const action of ['completed', 'reopened'] as const) {
      expect(canRevert(entry({ action, before: { completed: false }, after: { completed: true } })))
        .toBe(true);
    }
  });

  it('rejects null entries instead of throwing', () => {
    expect(canRevert(null)).toBe(false);
    expect(canRevert(undefined)).toBe(false);
  });
});

describe('describeRevert', () => {
  it('describes each action in plain language', () => {
    expect(describeRevert(entry({ action: 'created' }))).toContain('delete the task');
    expect(describeRevert(entry({ action: 'deleted' }))).toContain('restore the deleted task');
    expect(describeRevert(entry({ action: 'completed' }))).toContain('not completed');
    expect(describeRevert(entry({ action: 'reopened' }))).toContain('as completed again');
    expect(describeRevert(entry({ action: 'updated' }))).toContain('previous values');
  });

  it('includes the title when there is one and omits it otherwise', () => {
    expect(describeRevert(entry({ title: 'Write report' }))).toContain('“Write report”');
    expect(describeRevert(entry({ title: '' }))).not.toContain('“');
  });
});
