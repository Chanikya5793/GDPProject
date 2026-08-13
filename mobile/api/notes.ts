import { Note, PlannerRecordId, Tag } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';
import { createPlannerItem, deletePlannerItem, listPlannerItems, updatePlannerItem } from './plannerClient';

const NOTES_KEY = 'nw_notes';
const TAGS_KEY = 'nw_tags';

function defaultTags(): Tag[] {
  return [
    { id: 1, name: 'Chemistry', color: '#DBEAFE' },
    { id: 2, name: 'CS', color: '#DCFCE7' },
    { id: 3, name: 'History', color: '#FEF3C7' },
    { id: 4, name: 'Study Tips', color: '#F3E8FF' },
  ];
}

async function loadNotes(): Promise<Note[]> {
  return getItem<Note[]>(NOTES_KEY, []);
}

async function saveNotes(notes: Note[]): Promise<void> {
  await setItem(NOTES_KEY, notes);
}

export async function getNotes(userId: string): Promise<Note[]> {
  return (await listPlannerItems<Note>('note')).filter(n => n.userId === userId);
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
  };
  return createPlannerItem('note', newNote);
}

export async function updateNote(id: PlannerRecordId, updates: Partial<Note>): Promise<Note> {
  return updatePlannerItem<Note>('note', id, { ...updates, updatedAt: new Date().toISOString() });
}

export async function deleteNote(id: PlannerRecordId): Promise<void> {
  const all = await loadNotes();
  const note = all.find(n => n.id === id);
  if (note) await addToTrash(note, 'note');
  await deletePlannerItem('note', id);
}

export async function restoreNoteDirect(note: Note): Promise<void> {
  await createPlannerItem('note', note);
}

export async function getTags(): Promise<Tag[]> {
  return getItem<Tag[]>(TAGS_KEY, defaultTags());
}

export async function createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
  const tags = await getTags();
  const newTag: Tag = { ...tag, id: Date.now() };
  await setItem(TAGS_KEY, [...tags, newTag]);
  return newTag;
}

export async function deleteTag(id: number): Promise<void> {
  const tags = await getTags();
  await setItem(TAGS_KEY, tags.filter(t => t.id !== id));
  const notes = await loadNotes();
  await saveNotes(notes.map(n => ({ ...n, tagIds: n.tagIds.filter(tid => tid !== id) })));
}
