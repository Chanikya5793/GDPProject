// Tag assignment helpers for notes. Pure, so the membership rules are unit
// tested rather than only exercised through the editor.

import { Note, Tag } from '@/types';

/**
 * Add or remove a tag id, without duplicating one that is already present.
 *
 * Returns a new array: the caller passes it straight to updateNote, and mutating
 * the note's own array would defeat the activity log's before/after comparison.
 */
export function toggleTagId(tagIds: number[], tagId: number): number[] {
  return tagIds.includes(tagId)
    ? tagIds.filter(id => id !== tagId)
    : [...tagIds, tagId];
}

export function hasTag(note: Pick<Note, 'tagIds'>, tagId: number): boolean {
  return note.tagIds.includes(tagId);
}

/** The tags assigned to a note, in the order the tag list defines. */
export function assignedTags(tags: Tag[], tagIds: number[]): Tag[] {
  return tags.filter(tag => tagIds.includes(tag.id));
}

/**
 * Drop ids with no matching tag.
 *
 * Deleting a tag strips it from every note, but a note restored from the trash
 * can still carry an id for a tag that no longer exists.
 */
export function pruneMissingTagIds(tagIds: number[], tags: Tag[]): number[] {
  const known = new Set(tags.map(tag => tag.id));
  return tagIds.filter(id => known.has(id));
}
