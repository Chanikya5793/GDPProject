import { addToTrash } from './trash'
import { addLog } from './logs'
import { createRecord, deleteRecord, listRecords, updateRecord } from './plannerStore'
import { getSecureCollection, setSecureCollection } from './secureCollections'

const TAGS_NAMESPACE = 'metadata:tags'
const DEFAULT_TAGS = [
  { id: 'chemistry', name: 'Chemistry', color: '#DBEAFE' },
  { id: 'cs', name: 'CS', color: '#DCFCE7' },
  { id: 'history', name: 'History', color: '#FEF3C7' },
  { id: 'study-tips', name: 'Study Tips', color: '#F3E8FF' },
]

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

export async function getTags() {
  return getSecureCollection(TAGS_NAMESPACE, DEFAULT_TAGS)
}

export async function createTag(tag) {
  const tags = await getTags()
  const created = { ...tag, id: `tag_${crypto.randomUUID()}` }
  await setSecureCollection(TAGS_NAMESPACE, [...tags, created])
  await addLog('created', 'tag', created.name, { entityId: created.id, after: created })
  return created
}

export async function updateTag(id, updates) {
  const tags = await getTags()
  const before = tags.find(tag => String(tag.id) === String(id))
  const updated = tags.map(tag => String(tag.id) === String(id) ? { ...tag, ...updates } : tag)
  await setSecureCollection(TAGS_NAMESPACE, updated)
  const tag = updated.find(item => String(item.id) === String(id))
  await addLog('updated', 'tag', tag?.name, { entityId: id, before, after: tag })
  return tag
}

export async function deleteTag(id) {
  const tags = await getTags()
  const tag = tags.find(item => String(item.id) === String(id))
  await setSecureCollection(TAGS_NAMESPACE, tags.filter(item => String(item.id) !== String(id)))
  const notes = await getNotes()
  await Promise.all(notes.filter(note => note.tagIds?.includes(id)).map(note =>
    updateRecord('note', note.id, { tagIds: note.tagIds.filter(tagId => tagId !== id) })
  ))
  await addLog('deleted', 'tag', tag?.name, { entityId: id, before: tag })
  return { success: true }
}

export async function restoreTagDirect(tag) {
  const tags = await getTags()
  if (!tags.some(item => String(item.id) === String(tag.id))) {
    await setSecureCollection(TAGS_NAMESPACE, [...tags, tag])
  }
}

