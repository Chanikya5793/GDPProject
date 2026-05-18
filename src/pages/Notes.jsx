// Two-panel layout: note list on left, editor on right.

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
function NoteListItem({ note, selected }) {
  // Strip markdown characters from preview text
  const preview = note.body.replace(/[#*_`>\-]/g, '').slice(0, 80)
  const noteTags = TAGS.filter(t => note.tagIds.includes(t.id))

  return (
    // "selected" class highlights the active note in the list
    // onClick will call setSelectedId(note.id)
    <div className={`note-list-item${selected ? ' selected' : ''}`}>
      <div className="note-list-title">{note.title}</div>
      {preview && <div className="note-list-preview">{preview}…</div>}
      <div className="note-list-meta">
        <span className="note-list-date">
          {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <div className="note-list-tags">
          {noteTags.map(t => (
            <span key={t.id} className="note-list-tag" style={{ background: t.color }}>
              #{t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// MAIN PAGE
export default function Notes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Notes</h1>
          <p>3 notes · 4 tags</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {/* onClick opens tag manager modal */}
          <button className="btn-ghost">Manage Tags</button>
          {/* onClick calls createNote() */}
          <button className="btn-primary">+ New Note</button>
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
            {NOTES.map(note => (
              <NoteListItem
                key={note.id}
                note={note}
                selected={note.id === SELECTED_NOTE.id}
              />
            ))}
          </div>

        </div>

        {/* RIGHT PANEL - note editor */}
        <div className="notes-editor-panel">
          <div className="note-editor">

            {/* EDITOR HEADER - title + write/preview toggle + delete */}
            <div className="note-editor-header">
              {/* onChange updates title state */}
              <input
                className="note-title-input"
                defaultValue={SELECTED_NOTE.title}
                placeholder="Note title..."
              />
              <div className="note-editor-actions">

                {/* Write / Preview toggle */}
                {/* onClick sets editorMode state */}
                <div className="editor-mode-toggle">
                  <button className="editor-mode-btn active">Write</button>
                  <button className="editor-mode-btn">Preview</button>
                </div>

                {/* Save button - only shows up when there are unsaved changes */}
                {/* Do we want it to autosave? */}
                <button className="btn-primary">Save</button>

                {/* Delete button */}
                <button className="btn-danger" title="Delete note">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* TAGS ROW - shows tags on this note + add tag button */}
            <div className="note-tags-row">
              {SELECTED_TAGS.map(tag => (
                <span key={tag.id} className="tag-chip" style={{ background: tag.color }}>
                  #{tag.name}
                  {/* onClick removes tag */}
                  <button className="tag-chip-remove">✕</button>
                </span>
              ))}
              {/* onClick opens tag picker dropdown */}
              <button className="tag-add-btn">+ Tag</button>

              {/* TAG PICKER DROPDOWN - shown when + Tag is clicked */}
              {/* Should close when clicking outside the box */}
              <div className="tag-picker">
                {TAGS.map(tag => (
                  <div
                    key={tag.id}
                    className={`tag-picker-item${SELECTED_NOTE.tagIds.includes(tag.id) ? ' selected' : ''}`}
                  >
                    <span className="tag-picker-dot" style={{ background: tag.color }} />
                    #{tag.name}
                    {SELECTED_NOTE.tagIds.includes(tag.id) && (
                      <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* WRITE MODE - plain textarea */}
            {/* onChange updates body state */}
            <textarea
              className="note-body-input"
              defaultValue={SELECTED_NOTE.body}
              placeholder="Start writing your note..."
            />

            {/* MARKDOWN HINT - always visible at bottom in write mode */}
            <div className="note-markdown-hint">
              <strong>Markdown:</strong>
              &nbsp;## Heading &nbsp;·&nbsp; **bold** &nbsp;·&nbsp; *italic*
              &nbsp;·&nbsp; - list &nbsp;·&nbsp; {'>'} quote &nbsp;·&nbsp; `code`
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
