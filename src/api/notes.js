import { addToTrash } from './trash'
import { addLog } from './logs'

const STORAGE_KEY = 'nw_notes'
const TAGS_KEY = 'nw_tags'

function loadNotes() {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : defaultNotes()
}

function saveNotes(notes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
}

function loadTags() {
    const raw = localStorage.getItem(TAGS_KEY)
    return raw ? JSON.parse(raw) : defaultTags()
}

function saveTags(tags) {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags))
}

function defaultTags() {
    return [
        { id: 1, name: 'Chemistry', color: '#DBEAFE' },
        { id: 2, name: 'CS', color: '#DCFCE7' },
        { id: 3, name: 'History', color: '#FEF3C7' },
        { id: 4, name: 'Study Tips', color: '#F3E8FF' },
    ]
}

function defaultNotes() {
    return [
        {
            id: 1,
            userId: 1,
            title: 'Binary Search Trees',
            body: 'A BST maintains the property that left child < parent < right child.\n\n## Key Operations\n- **Insert**: O(log n) average\n- **Search**: O(log n) average\n- **Delete**: O(log n) average\n\n## Traversals\n- In-order: left, root, right (sorted output)\n- Pre-order: root, left, right\n- Post-order: left, right, root',
            tagIds: [2],
            updatedAt: new Date(Date.now() - 86400000).toISOString(),
            createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        },
        {
            id: 2,
            userId: 1,
            title: 'Reaction Mechanisms Overview',
            body: 'SN1 reactions proceed via carbocation intermediate. SN2 reactions are concerted.\n\n## SN1 vs SN2\n- SN1: two-step, favored by tertiary substrates\n- SN2: one-step, favored by primary substrates\n\n## Key Factors\n- Solvent polarity\n- Leaving group ability\n- Nucleophile strength',
            tagIds: [1],
            updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
            createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        },
        {
            id: 3,
            userId: 1,
            title: 'Active Recall Technique',
            body: 'Instead of rereading, close the book and write down everything you remember.\n\n## Steps\n1. Read a section once\n2. Close the material\n3. Write everything you recall\n4. Check what you missed\n5. Focus review on gaps\n\n> "Testing yourself is one of the most effective study strategies." - Make It Stick',
            tagIds: [4],
            updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
            createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
        },
    ]
}

export async function getNotes(userId) {
    return loadNotes().filter(n => n.userId === userId)
}

export async function createNote(note) {
    const notes = loadNotes()
    const newNote = {
        ...note,
        id: Date.now(),
        tagIds: note.tagIds || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }
    saveNotes([newNote, ...notes])
    addLog('created', 'note', newNote.title)
    return newNote
}

export async function updateNote(id, updates) {
    const notes = loadNotes()
    const updated = notes.map(n =>
        n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
    )
    saveNotes(updated)
    const note = updated.find(n => n.id === id)
    addLog('updated', 'note', note?.title)
    return note
}

export async function deleteNote(id) {
    const notes = loadNotes()
    const note = notes.find(n => n.id === id)
    if (note) await addToTrash(note, 'note')
    saveNotes(notes.filter(n => n.id !== id))
    addLog('deleted', 'note', note?.title)
    return { success: true }
}

export function restoreNoteDirect(note) {
    const notes = loadNotes()
    notes.unshift(note)
    saveNotes(notes)
}

export async function getTags() {
    return loadTags()
}

export async function createTag(tag) {
    const tags = loadTags()
    const newTag = { ...tag, id: Date.now() }
    saveTags([...tags, newTag])
    addLog('created', 'tag', newTag.name)
    return newTag
}

export async function updateTag(id, updates) {
    const tags = loadTags()
    const updated = tags.map(t => t.id === id ? { ...t, ...updates } : t)
    saveTags(updated)
    const tag = updated.find(t => t.id === id)
    addLog('updated', 'tag', tag?.name)
    return tag
}

export async function deleteTag(id) {
    const tags = loadTags()
    const tag = tags.find(t => t.id === id)
    saveTags(tags.filter(t => t.id !== id))
    const notes = loadNotes()
    saveNotes(notes.map(n => ({ ...n, tagIds: n.tagIds.filter(tid => tid !== id) })))
    addLog('deleted', 'tag', tag?.name)
    return { success: true }
}
