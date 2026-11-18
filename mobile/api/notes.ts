import { Note, PlannerRecordId } from '@/types';
import { getItem } from './storage';
export { getTags, createTag, updateTag, deleteTag, restoreTagDirect } from './tags';
import { addToTrash } from './trash';
import { addLog } from './logs';
import { createPlannerItem, deletePlannerItem, readCachedPlannerItems, updatePlannerItem } from './plannerClient';

const NOTES_KEY = 'nw_notes';
async function loadNotes(): Promise<Note[]> {
  return getItem<Note[]>(NOTES_KEY, []);
}

export async function getNotes(userId: string): Promise<Note[]> {
  return (await readCachedPlannerItems<Note>('note')).filter(n => n.userId === userId);
}

export async function createNote(note: Partial<Note> & { userId: string }): Promise<Note> {
  const newNote: Note = {
    id: Date.now(),
    userId: note.userId,
    title: note.title || 'Untitled Note',
    body: note.body || '',
    tagIds: note.tagIds || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Rebuilt field by field above, so anything not named here is dropped --
    // which is how the assistant-visibility flag went missing on every task
    // created from this client.
    _approvedForAi: note._approvedForAi ?? true,
  };
  const created = await createPlannerItem('note', newNote);
  await addLog('created', 'note', created.title, { entityId: created.id, after: created });
  return created;
}

export async function updateNote(id: PlannerRecordId, updates: Partial<Note>): Promise<Note> {
  const before = (await readCachedPlannerItems<Note>('note')).find(n => String(n.id) === String(id));
  const updated = await updatePlannerItem<Note>('note', id, {
    ...updates, updatedAt: new Date().toISOString(),
  });
  await addLog('updated', 'note', updated.title, { entityId: id, before, after: updated });
  return updated;
}

export async function deleteNote(id: PlannerRecordId): Promise<void> {
  const all = await loadNotes();
  const note = all.find(n => n.id === id);
  let trashId: string | undefined;
  if (note) trashId = await addToTrash(note, 'note');
  await deletePlannerItem('note', id);
  await addLog('deleted', 'note', note?.title || '', { entityId: id, before: note, trashId });
}

export async function restoreNoteDirect(note: Note): Promise<void> {
  await createPlannerItem('note', note);
}
