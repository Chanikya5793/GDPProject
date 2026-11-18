// Tag assignment helpers for notes. Pure, so the membership rules are unit
// tested rather than only exercised through the editor.

import { Note, PlannerRecordId, Tag } from '@/types';

/**
 * Add or remove a tag id, without duplicating one that is already present.
 *
 * Returns a new array: the caller passes it straight to updateNote, and mutating
 * the note's own array would defeat the activity log's before/after comparison.
 */
export function toggleTagId(tagIds: PlannerRecordId[], tagId: PlannerRecordId): PlannerRecordId[] {
  return tagIds.some(id => String(id) === String(tagId))
    ? tagIds.filter(id => String(id) !== String(tagId))
    : [...tagIds, tagId];
}

export function hasTag(note: Pick<Note, 'tagIds'>, tagId: PlannerRecordId): boolean {
  return note.tagIds.some(id => String(id) === String(tagId));
}

/** The tags assigned to a note, in the order the tag list defines. */
export function assignedTags(tags: Tag[], tagIds: PlannerRecordId[]): Tag[] {
  return tags.filter(tag => tagIds.some(id => String(id) === String(tag.id)));
}

/**
 * Drop ids with no matching tag.
 *
 * Deleting a tag strips it from every note, but a note restored from the trash
 * can still carry an id for a tag that no longer exists.
 */
export function pruneMissingTagIds(tagIds: PlannerRecordId[], tags: Tag[]): PlannerRecordId[] {
  const known = new Set(tags.map(tag => String(tag.id)));
  return tagIds.filter(id => known.has(String(id)));
}
