const NOTES_KEY = 'nw_notes'

function loadNotes() {
    const raw = localStorage.getItem(NOTES_KEY)
    return raw ? JSON.parse(raw) : defaultNotes()
}

function saveNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

function defaultNotes() {
    return [
        {
            id: 1,
            userId: 1,
            title: 'Binary Search Trees',
            body: 'A BST maintains the property that left child < parent < right child',
            //tagIds: [2],
            updatedAt: '2026-05-12T14:30:00Z',    
        },
        {
            id: 2,
            userId: 1,
            title: 'Reaction Mechanisms Overview',
            body: 'SN1 reactions proceed via carbocation intermediate. SN2 reactions are concerted',
            //tagIds: [1],
            updatedAt: '2026-05-12T14:30:00Z',
        },
        {
            id: 3,
            userId: 1,
            title: 'Active Recall Technique',
            body: 'Instead of rereading, close the book and write down everything you remember',
            //tagIds: [4],
            updatedAt: '2026-05-11T09:00:00Z',
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
        updatedAt: new Date().toISOString(),
    }
    saveNotes([...notes, newNote])
    return newNote
}

export async function updateNote(id, updates) {
    const notes = loadNotes()
    const updated = notes.map(n => n.id === id
        ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
    )
    saveNotes(updated)
    return updated.find(n => n.id === id)
}

export async function deleteNote(id) {
    saveNotes(loadNotes().filter(n => n.id !== id))
    return { success: true }
}
