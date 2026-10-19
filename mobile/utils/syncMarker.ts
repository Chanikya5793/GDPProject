export type MarkerKind = 'task' | 'reminder' | 'note';

/** users/{uid}/meta/sync as the backend writes it (backend/app/repository.py). */
export interface SyncMarker {
  version?: number;
  by?: string;
  task?: number;
  reminder?: number;
  note?: number;
  schedule?: number;
}

const KINDS: readonly MarkerKind[] = ['task', 'reminder', 'note'];

/**
 * Which lists to refetch when the change marker moves from `previous` to
 * `next`. Nothing on the first sighting (the launch refresh covers it), and
 * nothing when the only write since was this device's own.
 */
export function changedKinds(previous: SyncMarker | null, next: SyncMarker, self: string): MarkerKind[] {
  if (!previous) return [];
  const before = previous.version ?? 0;
  const after = next.version ?? 0;
  if (after <= before) return [];
  if (after === before + 1 && self && next.by === self) return [];
  // An older backend wrote only `version`: refetch everything.
  if (!['task', 'reminder', 'note', 'schedule'].some(kind => kind in next)) return [...KINDS];
  return KINDS.filter(kind => (next[kind] ?? 0) !== (previous[kind] ?? 0));
}
