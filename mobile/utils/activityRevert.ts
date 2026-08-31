// Pure rollback rules for the activity log — the decision half of
// src/api/activity.js. Kept free of entity-API imports so it can be unit tested
// in node, and so api/activity.ts (which does import them) stays thin.

import { LogEntry } from '@/types';

/**
 * Fields never rolled back: identifiers, timestamps, and attachment binaries.
 *
 * Attachment payloads are stripped from snapshots to keep them small, so
 * restoring `before` would blank the attachments rather than restore them.
 * Delete-rollback goes through the trash instead, where the record is intact.
 */
const NON_RESTORABLE = new Set(['id', 'userId', 'createdAt', 'updatedAt', 'attachments']);

type Snapshot = Record<string, unknown> | null | undefined;

/**
 * The minimal update that returns changed fields to their prior values — only
 * keys that actually differ, skipping the non-restorable ones.
 */
export function buildRevertUpdate(before: Snapshot, after: Snapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (NON_RESTORABLE.has(key)) continue;
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      out[key] = before?.[key];
    }
  }
  return out;
}

/** Whether an entry carries enough data, and a reversible action, to roll back. */
export function canRevert(entry: LogEntry | null | undefined): boolean {
  if (!entry || entry.reverted || entry.action === 'reverted') return false;
  if (entry.entityId === undefined) return false; // pre-upgrade entry, no snapshot
  switch (entry.action) {
    case 'created':
      return true;
    case 'deleted':
      return Boolean(entry.trashId || entry.before);
    case 'updated':
    case 'completed':
    case 'reopened': {
      // Offer rollback only when a restorable field actually changed: a note
      // whose only edit was an attachment has nothing this can put back.
      const changes = buildRevertUpdate(entry.before as Snapshot, entry.after as Snapshot);
      return Boolean(entry.before) && Object.keys(changes).length > 0;
    }
    default:
      return false;
  }
}

/** Plain-language description of what a rollback will do, for the confirm dialog. */
export function describeRevert(entry: LogEntry): string {
  const noun = `${entry.entity}${entry.title ? ` “${entry.title}”` : ''}`;
  switch (entry.action) {
    case 'created': return `This will delete the ${noun} you created.`;
    case 'deleted': return `This will restore the deleted ${noun}.`;
    case 'completed': return `This will mark the ${noun} as not completed again.`;
    case 'reopened': return `This will mark the ${noun} as completed again.`;
    case 'updated': return `This will restore the ${noun} to its previous values.`;
    default: return `This will undo the change to the ${noun}.`;
  }
}
