// Rollback engine for the activity log — the mobile counterpart of
// src/api/activity.js.
//
// Separate from logs.ts because it imports the entity APIs, which import logs.ts
// in turn; keeping the two apart avoids a require cycle. The decision rules live
// in utils/activityRevert.ts so they can be unit tested without these imports.

import { LogEntity, LogEntry, PlannerRecordId } from '@/types';
import { buildRevertUpdate, canRevert } from '@/utils/activityRevert';
import { addLog, markReverted, suppressLogging } from './logs';
import {
  deleteNote, deleteTag, restoreNoteDirect, restoreTagDirect, updateNote, updateTag,
} from './notes';
import { deleteReminder, restoreReminderDirect, updateReminder } from './reminders';
import { deleteTask, restoreTaskDirect, updateTask } from './tasks';
import { restoreFromTrash } from './trash';

type Updater = (id: PlannerRecordId, updates: Record<string, unknown>) => Promise<unknown>;
type Deleter = (id: PlannerRecordId) => Promise<unknown>;
type Restorer = (item: never) => Promise<unknown>;

const UPDATERS: Partial<Record<LogEntity, Updater>> = {
  task: updateTask as Updater,
  reminder: updateReminder as Updater,
  note: updateNote as Updater,
  tag: updateTag as Updater,
};
const DELETERS: Partial<Record<LogEntity, Deleter>> = {
  task: deleteTask, reminder: deleteReminder, note: deleteNote,
  tag: deleteTag as Deleter,
};
const RESTORERS: Partial<Record<LogEntity, Restorer>> = {
  task: restoreTaskDirect as Restorer,
  reminder: restoreReminderDirect as Restorer,
  note: restoreNoteDirect as Restorer,
  tag: restoreTagDirect as Restorer,
};

export interface RevertResult {
  ok: boolean;
  reason?: string;
}

function unsupported(entity: LogEntity): string {
  return `Rolling back a ${entity} is not supported on mobile yet.`;
}

/**
 * Apply a per-change rollback, then record the revert itself.
 *
 * The undo runs inside suppressLogging so it does not append its own entries;
 * a single explicit 'reverted' entry is written afterwards instead, which keeps
 * the history honest without letting it grow on every undo.
 */
export async function revertLog(entry: LogEntry): Promise<RevertResult> {
  if (!canRevert(entry)) return { ok: false, reason: 'This entry can’t be rolled back.' };
  const { entity, action, entityId, before, after, trashId, title } = entry;

  try {
    await suppressLogging(async () => {
      if (action === 'created') {
        const remove = DELETERS[entity];
        if (!remove) throw new Error(unsupported(entity));
        await remove(entityId as PlannerRecordId);
        return;
      }

      if (action === 'deleted') {
        const restore = RESTORERS[entity];
        if (!restore) throw new Error(unsupported(entity));
        let restored = false;
        // Tags are not moved to the trash on delete, so there is no trash entry
        // to consult; the snapshot below is the only route back.
        if (trashId !== undefined) {
          const fromTrash = await restoreFromTrash(String(trashId));
          if (fromTrash) {
            const byType = RESTORERS[fromTrash.type as LogEntity];
            if (byType) { await byType(fromTrash.item as never); restored = true; }
          }
        }
        // The trash entry may have been emptied; the snapshot is the fallback.
        if (!restored && before) await restore(before as never);
        return;
      }

      // updated / completed / reopened
      const update = UPDATERS[entity];
      if (!update) throw new Error(unsupported(entity));
      const payload = buildRevertUpdate(
        before as Record<string, unknown>, after as Record<string, unknown>,
      );
      const result = await update(entityId as PlannerRecordId, payload);
      if (!result) throw new Error('the item no longer exists');
    });
  } catch (error) {
    return { ok: false, reason: (error as Error)?.message || String(error) };
  }

  // Logged from `after` back to `before`, so the revert reads as its own change.
  await addLog('reverted', entity, title, {
    entityId, before: after, after: before, revertOf: entry.id,
  });
  await markReverted(entry.id);
  return { ok: true };
}
