import { addToTrash } from './trash'
import { addLog } from './logs'
import { createRecord, deleteRecord, listRecords, updateRecord } from './plannerStore'
import { getSecureCollection, updateSecureCollection } from './secureCollections'

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

function mutateTags(updater) {
  return updateSecureCollection(TAGS_NAMESPACE, DEFAULT_TAGS, updater)
}

export async function createTag(tag) {
  const created = { ...tag, id: `tag_${crypto.randomUUID()}` }
  await mutateTags(tags => [...tags, created])
  await addLog('created', 'tag', created.name, { entityId: created.id, after: created })
  return created
}

export async function updateTag(id, updates) {
  let before
  const updated = await mutateTags(tags => {
    before = tags.find(tag => String(tag.id) === String(id))
    return tags.map(tag => String(tag.id) === String(id) ? { ...tag, ...updates } : tag)
  })
  const tag = updated.find(item => String(item.id) === String(id))
  await addLog('updated', 'tag', tag?.name, { entityId: id, before, after: tag })
  return tag
}

export async function deleteTag(id) {
  let tag
  await mutateTags(tags => {
    tag = tags.find(item => String(item.id) === String(id))
    return tags.filter(item => String(item.id) !== String(id))
  })
  const notes = await getNotes()
  // One at a time: each update re-reads the note cache, and the log behind
  // them is one list too.
  for (const note of notes.filter(item => item.tagIds?.includes(id))) {
    await updateRecord('note', note.id, { tagIds: note.tagIds.filter(tagId => tagId !== id) })
  }
  await addLog('deleted', 'tag', tag?.name, { entityId: id, before: tag })
  return { success: true }
}

export async function restoreTagDirect(tag) {
  await mutateTags(tags => (
    tags.some(item => String(item.id) === String(tag.id)) ? undefined : [...tags, tag]
  ))
}

