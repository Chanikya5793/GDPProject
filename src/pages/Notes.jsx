// Two-panel layout: note list on left, editor on right.

import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getNotes, createNote, updateNote, deleteNote } from '../api/notes'
import { Search, Trash2 } from 'lucide-react'
import '../css/Notes.css'

// HARDCODED DATA - replace with API data

const TAGS = [
  {
    id: 1,
    name: 'Chemistry',
    color: '#DBEAFE'
  },
  {
    id: 2,
    name: 'CS',
    color: '#DCFCE7'
  },
  {
    id: 3,
    name: 'History',
    color: '#FEF3C7'
  },
  {
    id: 4,
    name: 'Study Tips',
    color: '#F3E8FF'
  },
]

const NOTES = [
  {
    id: 1,
    title: 'Binary Search Trees',
    body: 'A BST maintains the property that left child < parent < right child',
    tagIds: [2],
    updatedAt: '2026-05-13T10:00:00Z',
  },
  {
    id: 2,
    title: 'Reaction Mechanisms Overview',
    body: 'SN1 reactions proceed via carbocation intermediate. SN2 reactions are concerted',
    tagIds: [1],
    updatedAt: '2026-05-12T14:30:00Z',
  },
  {
    id: 3,
    title: 'Active Recall Technique',
    body: 'Instead of rereading, close the book and write down everything you remember',
    tagIds: [4],
    updatedAt: '2026-05-11T09:00:00Z',
  },
]

// Selected note
const SELECTED_NOTE = NOTES[0]
const SELECTED_TAGS = TAGS.filter(t => SELECTED_NOTE.tagIds.includes(t.id))

// NOTE LIST ITEM
function NoteListItem({ note, selected, onClick }) {
  // Strip markdown characters from preview text
  const preview = note.body.replace(/[#*_`>\-]/g, '').slice(0, 80)

  return (
    // "selected" class highlights the active note in the list
    // onClick will call setSelectedId(note.id)
    <div className={`note-list-item${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="note-list-title">{note.title || 'Untitled'}</div>
      {preview && <div className="note-list-preview">{preview}…</div>}
      <div className="note-list-meta">
        <span className="note-list-date">
          {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        
      </div>
    </div>
  )
}

// NOTE EDITOR
function NoteEditor({ note, onSave, onDelete }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [editorMode, setEditorMode] = useState('write')

    useEffect(() => {
      setTitle(note.title)
      setBody(note.body)
    }, [note.id])

    return (
      <div className="note-editor">
        {/* HEADER */}
        <div className="note-editor-header">
          <input className="note-title-input" value={title}
            onChange={e => { setTitle(e.target.value) }}
            placeholder="Note title..."
          />
          <div className="note-editor-actions">
            <div className="editor-mode-toggle">
              <button
                className={`editor-mode-btn${editorMode === 'write' ? ' active' : ''}`}
                onClick={() => setEditorMode('write')}
              >
                Write
              </button>
            </div>
          </div>
        </div>

        {/* WRITE MODE */}
        {editorMode === 'write' && (
          <textarea
            className="note-body-input"
            value={body}
            onChange={e => { setBody(e.target.value) }}
            placeholder="Start writing your note..."
          />
        )}
      </div>
    )
}

// MAIN PAGE

export default function Notes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    async function load() {
      const [n] = await Promise.all([getNotes(user.id)])
      setNotes(n)
      if (n.length > 0) setSelectedId(n[0].id)
      setLoading(false)
    }
    load()
  }, [user.id])

const selectedNote = notes.find(n => n.id === selectedId) || null

  // HANDLERS
  const handleNewNote = async() => {
    const note = await createNote({
      userId: user.id, title: '', body: '',
    })
    setNotes(prev => [note, ...prev])
    setSelectedId(note.id)
  }

  const handleSave = async(id, updates) => {
    const updated = await updateNote(id, updates)
    setNotes(prev => prev.map(n => n.id === id ? updated : n))
  }

  const handleDelete = async(id) => {
    await deleteNote(id)
    setNotes(prev => {
      const remaining = prev.filter(n => n.id !== id)
      setSelectedId(remaining.length > 0 ? remaining[0].id : null)
      return remaining
    })
  }
  
  if (loading) return (
    <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--muted)' }}>Loading notes...</p>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Notes</h1>
          <p>{notes.length} notes · {TAGS.length} tags</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {/* onClick opens tag manager modal */}
          <button className="btn-ghost">Manage Tags</button>
          {/* onClick calls createNote() */}
          <button className="btn-primary" onClick={handleNewNote}>+ New Note</button>
        </div>
      </div>

      {/* TWO-PANEL SHELL */}
      <div className="notes-shell">

        {/* LEFT PANEL - note list */}
        <div className="notes-list-panel">

          {/* SEARCH BAR */}
          <div className="notes-search-wrap">
            <Search className="notes-search-icon" size={15} />
            {/* onChange filters the note list */}
            <input className="notes-search" placeholder="Search notes..." />
          </div>

          {/* TAG FILTER DROPDOWN */}
          {/* onChange sets activeTagId */}
          <div className="notes-tag-filter">
            <select className="notes-tag-select">
              <option value="">All Notes</option>
              {TAGS.map(tag => (
                <option key={tag.id} value={tag.id}>#{tag.name}</option>
              ))}
            </select>
          </div>

          {/* NOTE LIST */}
          {/* onClick on each item sets selectedId */}
          <div className="notes-list">
            {notes.map(note => (
              <NoteListItem
                key={note.id}
                note={note}
                selected={note.id === selectedId}
                onClick={() => setSelectedId(note.id)}
              />
            ))}
          </div>

        </div>

        {/* RIGHT PANEL - note editor */}
        <div className="notes-editor-panel">
          {selectedNote ? (
            <NoteEditor
              key={selectedNote.id}
              note={selectedNote}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <h3>No note selected</h3>
              <p>Choose a note from the list or create a new one.</p>
              <button className="btn-primary" style={{ marginTop: '16px' }} onClick={handleNewNote}>
                + New Note
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
