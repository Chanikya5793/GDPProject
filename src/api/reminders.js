import { addToTrash } from './trash'
import { addLog } from './logs'
import { createRecord, deleteRecord, listRecords, updateRecord } from './plannerStore'

export async function getReminders() {
  return listRecords('reminder')
}

export async function createReminder(reminder) {
  const created = await createRecord('reminder', reminder)
  void addLog('created', 'reminder', created.title, { entityId: created.id, after: created })
  return created
}

export async function updateReminder(id, updates) {
  const before = (await listRecords('reminder')).find(item => String(item.id) === String(id))
  const updated = await updateRecord('reminder', id, updates)
  void addLog('updated', 'reminder', updated.title, { entityId: id, before, after: updated })
  return updated
}

export async function deleteReminder(id) {
  const reminder = (await listRecords('reminder')).find(item => String(item.id) === String(id))
  let trashId
  if (reminder) trashId = await addToTrash(reminder, 'reminder')
  await deleteRecord('reminder', id)
  void addLog('deleted', 'reminder', reminder?.title, { entityId: id, before: reminder, trashId })
  return { success: true }
}

export async function restoreReminderDirect(reminder) {
  return createRecord('reminder', { ...reminder, _revision: undefined })
}

