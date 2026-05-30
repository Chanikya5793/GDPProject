import { Note, Tag } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';

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

function defaultNotes(): Note[] {
  const now = Date.now();
  return [
    {
      id: 1, userId: 1, title: 'Binary Search Trees',
      body: 'A BST maintains the property that left child < parent < right child.\n\n## Key Operations\n- **Insert**: O(log n) average\n- **Search**: O(log n) average\n- **Delete**: O(log n) average',
      tagIds: [2],
      updatedAt: new Date(now - 86400000).toISOString(),
      createdAt: new Date(now - 86400000 * 3).toISOString(),
    },
    {
      id: 2, userId: 1, title: 'Reaction Mechanisms Overview',
      body: 'SN1 reactions proceed via carbocation intermediate. SN2 reactions are concerted.\n\n## SN1 vs SN2\n- SN1: two-step, favored by tertiary substrates\n- SN2: one-step, favored by primary substrates',
      tagIds: [1],
      updatedAt: new Date(now - 86400000 * 2).toISOString(),
      createdAt: new Date(now - 86400000 * 5).toISOString(),
    },
    {
      id: 3, userId: 1, title: 'Active Recall Technique',
      body: 'Instead of rereading, close the book and write down everything you remember.\n\n## Steps\n1. Read a section once\n2. Close the material\n3. Write everything you recall\n4. Check what you missed\n5. Focus review on gaps',
      tagIds: [4],
      updatedAt: new Date(now - 86400000 * 3).toISOString(),
      createdAt: new Date(now - 86400000 * 7).toISOString(),
    },
  ];
}

async function loadNotes(): Promise<Note[]> {
  return getItem<Note[]>(NOTES_KEY, defaultNotes());
}

async function saveNotes(notes: Note[]): Promise<void> {
  await setItem(NOTES_KEY, notes);
}

export async function getNotes(userId: number): Promise<Note[]> {
  const all = await loadNotes();
  return all.filter(n => n.userId === userId);
}

export async function createNote(note: Partial<Note> & { userId: number }): Promise<Note> {
  const all = await loadNotes();
  const newNote: Note = {
    id: Date.now(),
    userId: note.userId,
    title: note.title || 'Untitled Note',
    body: note.body || '',
    tagIds: note.tagIds || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveNotes([newNote, ...all]);
  return newNote;
}

export async function updateNote(id: number, updates: Partial<Note>): Promise<Note> {
  const all = await loadNotes();
  const updated = all.map(n =>
    n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
  );
  await saveNotes(updated);
  return updated.find(n => n.id === id)!;
}

export async function deleteNote(id: number): Promise<void> {
  const all = await loadNotes();
  const note = all.find(n => n.id === id);
  if (note) await addToTrash(note, 'note');
  await saveNotes(all.filter(n => n.id !== id));
}

export async function restoreNoteDirect(note: Note): Promise<void> {
  const all = await loadNotes();
  all.unshift(note);
  await saveNotes(all);
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
