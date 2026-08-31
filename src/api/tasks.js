import { addToTrash } from './trash'
import { addLog } from './logs'
import { createRecord, deleteRecord, listRecords, updateRecord } from './plannerStore'

export async function getTasks() {
  return listRecords('task')
}

export async function createTask(task) {
  const created = await createRecord('task', task)
  void addLog('created', 'task', created.title, { entityId: created.id, after: created })
  return created
}

export async function updateTask(id, updates) {
  const before = (await listRecords('task')).find(task => String(task.id) === String(id))
  const updated = await updateRecord('task', id, updates)
  void addLog('updated', 'task', updated.title, { entityId: id, before, after: updated })
  return updated
}

export async function deleteTask(id) {
  const task = (await listRecords('task')).find(item => String(item.id) === String(id))
  let trashId
  if (task) trashId = await addToTrash(task, 'task')
  await deleteRecord('task', id)
  void addLog('deleted', 'task', task?.title, { entityId: id, before: task, trashId })
  return { success: true }
}

export async function restoreTaskDirect(task) {
  return createRecord('task', { ...task, _revision: undefined })
}

export function restoreTaskDirect(task) {
    const tasks = load()
    tasks.push(task)
    save(tasks)
}

export async function toggleTask(id) {
  const before = (await listRecords('task')).find(task => String(task.id) === String(id))
  if (!before) throw new Error('Task not found')
  const updated = await updateRecord('task', id, { completed: !before.completed })
  void addLog(updated.completed ? 'completed' : 'reopened', 'task', updated.title, {
    entityId: id, before, after: updated,
  })
  return updated
}

export async function batchUpdateTasks(updates) {
  // Snapshot first so each entry carries a real `before` and stays rollbackable
  // from the activity log — this path previously wrote no log entries at all,
  // which matters more now that auto-balance can move tasks without a click.
  const before = await listRecords('task')
  const updated = await Promise.all(
    updates.map(update => updateRecord('task', update.id, update.changes))
  )
  // Sequential: addLog does a read-modify-write of one log store, so logging
  // concurrently would drop entries.
  for (const task of updated) {
    const prior = before.find(item => String(item.id) === String(task.id))
    await addLog('updated', 'task', task.title, { entityId: task.id, before: prior, after: task })
  }
  return updated
}

