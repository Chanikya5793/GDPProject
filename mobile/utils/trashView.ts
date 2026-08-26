// Presentation helpers for the Recycle Bin. Pure so they can be unit tested in
// node; the component keeps only rendering and the calls into api/trash.

import { TrashItem } from '@/types';

export type TrashFilter = 'all' | 'task' | 'reminder' | 'note';

export const TRASH_FILTERS: { value: TrashFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'reminder', label: 'Reminders' },
  { value: 'note', label: 'Notes' },
];

export function filterTrash(items: TrashItem[], filter: TrashFilter): TrashItem[] {
  return filter === 'all' ? items : items.filter(item => item._trashType === filter);
}

export function countByType(items: TrashItem[], filter: TrashFilter): number {
  return filter === 'all' ? items.length : filterTrash(items, filter).length;
}

/**
 * How long ago something was deleted, in the coarse terms this list needs.
 *
 * `now` is a parameter rather than a call to Date.now() so the tests do not
 * drift with the clock.
 */
export function deletedAgo(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return 'recently';
  const days = Math.floor(elapsed / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
