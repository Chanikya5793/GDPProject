import { describe, expect, it } from 'vitest';

import { assignedTags, hasTag, pruneMissingTagIds, toggleTagId } from './noteTags';
import { Tag } from '@/types';

const TAGS: Tag[] = [
  { id: 1, name: 'Chemistry', color: '#DBEAFE' },
  { id: 2, name: 'CS', color: '#DCFCE7' },
  { id: 3, name: 'History', color: '#FEF3C7' },
];

describe('toggleTagId', () => {
  it('adds a tag that is not present', () => {
    expect(toggleTagId([1], 2)).toEqual([1, 2]);
  });

  it('removes a tag that is present', () => {
    expect(toggleTagId([1, 2], 1)).toEqual([2]);
  });

  it('does not duplicate an id that is already there', () => {
    expect(toggleTagId([1, 2], 2)).toEqual([1]);
    expect(toggleTagId([2, 2], 2)).toEqual([]);
  });

  it('returns a new array rather than mutating the input', () => {
    // The note's own array is compared against in the activity log's
    // before/after diff; mutating it in place would hide the change.
    const original = [1];
    const next = toggleTagId(original, 2);
    expect(original).toEqual([1]);
    expect(next).not.toBe(original);
  });

  it('handles an empty starting list', () => {
    expect(toggleTagId([], 3)).toEqual([3]);
  });
});

describe('hasTag', () => {
  it('reports membership', () => {
    expect(hasTag({ tagIds: [1, 2] }, 2)).toBe(true);
    expect(hasTag({ tagIds: [1, 2] }, 3)).toBe(false);
    expect(hasTag({ tagIds: [] }, 1)).toBe(false);
  });
});

describe('assignedTags', () => {
  it('returns the tags a note carries, in tag-list order', () => {
    expect(assignedTags(TAGS, [3, 1]).map(t => t.name)).toEqual(['Chemistry', 'History']);
  });

  it('ignores ids with no matching tag', () => {
    expect(assignedTags(TAGS, [1, 99])).toHaveLength(1);
  });

  it('returns empty for an untagged note', () => {
    expect(assignedTags(TAGS, [])).toEqual([]);
  });
});

describe('pruneMissingTagIds', () => {
  it('drops ids whose tag no longer exists', () => {
    // A note restored from the trash can still reference a deleted tag.
    expect(pruneMissingTagIds([1, 99, 2], TAGS)).toEqual([1, 2]);
  });

  it('leaves a fully valid list alone', () => {
    expect(pruneMissingTagIds([1, 2, 3], TAGS)).toEqual([1, 2, 3]);
  });

  it('returns empty when every tag is gone', () => {
    expect(pruneMissingTagIds([1, 2], [])).toEqual([]);
  });
});
