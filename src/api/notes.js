import { addToTrash } from './trash'
import { addLog } from './logs'
import { createRecord, deleteRecord, listRecords, updateRecord } from './plannerStore'
export { getTags, createTag, updateTag, deleteTag, restoreTagDirect } from './tags'

export async function getNotes() {
  return listRecords('note')
}

export async function createNote(note) {
  const created = await createRecord('note', {
    ...note, title: note.title || 'Untitled Note', tagIds: note.tagIds || [],
  })
  await addLog('created', 'note', created.title, { entityId: created.id, after: created })
  return created
}

export async function updateNote(id, updates) {
  const before = (await listRecords('note')).find(note => String(note.id) === String(id))
  const updated = await updateRecord('note', id, updates)
  await addLog('updated', 'note', updated.title, { entityId: id, before, after: updated })
  return updated
}

export async function deleteNote(id) {
  const note = (await listRecords('note')).find(item => String(item.id) === String(id))
  let trashId
  if (note) trashId = await addToTrash(note, 'note')
  await deleteRecord('note', id)
  await addLog('deleted', 'note', note?.title, { entityId: id, before: note, trashId })
  return { success: true }
}

export async function restoreNoteDirect(note) {
  return createRecord('note', { ...note, _revision: undefined })
}
