import { describe, expect, it } from 'vitest';

import { countByType, deletedAgo, filterTrash } from './trashView';
import { TrashItem } from '@/types';

const NOW = new Date('2026-08-25T12:00:00.000Z').getTime();

function item(type: TrashItem['_trashType'], id: string, deletedAt = '2026-08-25T11:00:00.000Z'): TrashItem {
  return { _trashId: id, _trashType: type, _deletedAt: deletedAt, title: `${type} ${id}` };
}

const TRASH = [
  item('task', 'a'), item('task', 'b'), item('reminder', 'c'), item('note', 'd'),
];

describe('filterTrash', () => {
  it('returns everything for the all filter', () => {
    expect(filterTrash(TRASH, 'all')).toHaveLength(4);
  });

  it('narrows to a single type', () => {
    expect(filterTrash(TRASH, 'task').map(i => i._trashId)).toEqual(['a', 'b']);
    expect(filterTrash(TRASH, 'note').map(i => i._trashId)).toEqual(['d']);
  });

  it('returns empty rather than throwing when a type is absent', () => {
    expect(filterTrash([item('task', 'a')], 'note')).toEqual([]);
  });
});

describe('countByType', () => {
  it('counts the whole bin for all, and one type otherwise', () => {
    expect(countByType(TRASH, 'all')).toBe(4);
    expect(countByType(TRASH, 'task')).toBe(2);
    expect(countByType(TRASH, 'reminder')).toBe(1);
    expect(countByType(TRASH, 'note')).toBe(1);
  });
});

describe('deletedAgo', () => {
  it('says today for anything under a day', () => {
    expect(deletedAgo('2026-08-25T11:00:00.000Z', NOW)).toBe('today');
    expect(deletedAgo('2026-08-25T12:00:00.000Z', NOW)).toBe('today');
  });

  it('says yesterday for one day', () => {
    expect(deletedAgo('2026-08-24T11:00:00.000Z', NOW)).toBe('yesterday');
  });

  it('counts days beyond that', () => {
    expect(deletedAgo('2026-08-20T12:00:00.000Z', NOW)).toBe('5d ago');
  });

  it('does not report a negative age for a future timestamp', () => {
    // Clock skew between devices should not render as "-1d ago".
    expect(deletedAgo('2026-08-26T12:00:00.000Z', NOW)).toBe('today');
  });

  it('degrades gracefully on an unparseable timestamp', () => {
    expect(deletedAgo('not-a-date', NOW)).toBe('recently');
  });
});
