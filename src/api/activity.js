/* Rollback engine for the activity log — "per-change undo".

   This lives in its own module (not logs.js) because it imports the entity
   APIs, which in turn import logs.js. Keeping the revert logic here avoids a
   circular dependency. */

import { updateTask, deleteTask, restoreTaskDirect } from './tasks'
import { updateReminder, deleteReminder, restoreReminderDirect } from './reminders'
import {
  updateNote, deleteNote, restoreNoteDirect,
  updateTag, deleteTag, restoreTagDirect,
} from './notes'
import { restoreFromTrash } from './trash'
import { addLog, markReverted, suppressLogging } from './logs'

const UPDATERS = { task: updateTask, reminder: updateReminder, note: updateNote, tag: updateTag }
const DELETERS = { task: deleteTask, reminder: deleteReminder, note: deleteNote, tag: deleteTag }
const RESTORERS = { task: restoreTaskDirect, reminder: restoreReminderDirect, note: restoreNoteDirect, tag: restoreTagDirect }

// Fields we never try to roll back: identifiers, timestamps, and attachment
// binaries (their base64 is stripped from snapshots, so restoring `before`
// would blank them — delete-rollback uses the trash instead, which is intact).
const NON_RESTORABLE = new Set(['id', 'userId', 'createdAt', 'updatedAt', 'attachments'])

/* Build the minimal update that returns the changed fields to their prior
   values — only the keys that actually differ, skipping non-restorable ones. */
function buildRevertUpdate(before = {}, after = {}) {
  const out = {}
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const k of keys) {
    if (NON_RESTORABLE.has(k)) continue
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
      out[k] = before?.[k]
    }
  }
  return out
}

/* Whether an entry can be rolled back (has the data + a reversible action). */
export function canRevert(entry) {
  if (!entry || entry.reverted || entry.action === 'reverted') return false
  if (entry.entityId === undefined) return false // pre-upgrade entry, no snapshot
  switch (entry.action) {
    case 'created': return true
    case 'deleted': return !!(entry.trashId || entry.before)
    case 'updated':
    case 'completed':
    case 'reopened': return !!entry.before
    default: return false
  }
}

/* Plain-language description of what a rollback will do (for the confirm dialog). */
export function describeRevert(entry) {
  const noun = `${entry.entity}${entry.title ? ` “${entry.title}”` : ''}`
  switch (entry.action) {
    case 'created': return `This will delete the ${noun} you created.`
    case 'deleted': return `This will restore the deleted ${noun}.`
    case 'completed': return `This will mark the ${noun} as not completed again.`
    case 'reopened': return `This will mark the ${noun} as completed again.`
    case 'updated': return `This will restore the ${noun} to its previous values.`
    default: return `This will undo the change to the ${noun}.`
  }
}

/* Apply a per-change rollback. Records a 'reverted' entry and badges the
   original. Returns { ok, reason? }. */
export async function revertLog(entry) {
  if (!canRevert(entry)) return { ok: false, reason: 'This entry can’t be rolled back.' }
  const { entity, action, entityId, before, after, trashId, title } = entry

  try {
    await suppressLogging(async () => {
      if (action === 'created') {
        await DELETERS[entity]?.(entityId)
      } else if (action === 'deleted') {
        let restored = false
        if (trashId) {
          const res = await restoreFromTrash(trashId)
          if (res) { RESTORERS[res.type]?.(res.item); restored = true }
        }
        if (!restored && before) RESTORERS[entity]?.(before)
      } else {
        // updated / completed / reopened
        const payload = buildRevertUpdate(before, after)
        const res = await UPDATERS[entity]?.(entityId, payload)
        if (!res) throw new Error('the item no longer exists')
      }
    })
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) }
  }

  // Honest history: the revert is itself logged (from `after` back to `before`).
  addLog('reverted', entity, title, { entityId, before: after, after: before, revertOf: entry.id })
  markReverted(entry.id)
  return { ok: true }
}
