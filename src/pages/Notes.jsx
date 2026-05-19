import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { getNotes, createNote, updateNote, deleteNote, getTags, createTag, deleteTag } from '../api/notes'
import { Search, Trash2, X } from 'lucide-react'
import '../css/Notes.css'

const TAG_COLORS = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#F3E8FF', '#FEE2E2', '#E0E7FF', '#CCFBF1']

function NoteListItem({ note, selected, tags, onClick }) {
  const preview = note.body.replace(/[#*_`>\-\[\]]/g, '').slice(0, 80)
  const noteTags = tags.filter(t => note.tagIds.includes(t.id))

  return (
    <div className={`note-list-item${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="note-list-title">{note.title || 'Untitled'}</div>
      {preview && <div className="note-list-preview">{preview}…</div>}
      <div className="note-list-meta">
        <span className="note-list-date">
          {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <div className="note-list-tags">
          {noteTags.map(t => (
            <span key={t.id} className="note-list-tag" style={{ background: t.color }}>#{t.name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function TagManagerModal({ tags, onCreateTag, onDeleteTag, onClose }) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const handleAdd = () => {
    if (!newName.trim()) return
    onCreateTag({ name: newName.trim(), color: newColor })
    setNewName('')
    setNewColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)])
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Manage Tags</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="New tag name..." onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1 }} />
          <select className="form-select" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: '80px', padding: '5px' }}>
            {TAG_COLORS.map(c => <option key={c} value={c} style={{ background: c }}>■</option>)}
          </select>
          <button className="btn-primary" onClick={handleAdd} style={{ whiteSpace: 'nowrap' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {tags.map(tag => (
            <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <span style={{ width: '14px', height: '14px', borderRadius: '4px', background: tag.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '14px', fontWeight: 600 }}>#{tag.name}</span>
              <button className="btn-icon btn-icon-danger" style={{ width: '24px', height: '24px' }} onClick={() => onDeleteTag(tag.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {tags.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>No tags yet. Create one above.</p>}
        </div>
      </div>
    </div>
  )
}

export default function Notes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [editorMode, setEditorMode] = useState('write')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [showTagManager, setShowTagManager] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const tagPickerRef = useRef(null)

  useEffect(() => {
    Promise.all([getNotes(user.id), getTags()]).then(([n, t]) => {
      setNotes(n)
      setTags(t)
      if (n.length > 0) {
        setSelectedId(n[0].id)
        setEditTitle(n[0].title)
        setEditBody(n[0].body)
      }
      setLoading(false)
    })
  }, [user.id])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target)) {
        setTagPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedNote = notes.find(n => n.id === selectedId)
  const selectedTags = selectedNote ? tags.filter(t => selectedNote.tagIds.includes(t.id)) : []

  const selectNote = (note) => {
    if (dirty && selectedNote) {
      handleSave()
    }
    setSelectedId(note.id)
    setEditTitle(note.title)
    setEditBody(note.body)
    setDirty(false)
    setEditorMode('write')
  }

  const handleSave = async () => {
    if (!selectedNote) return
    const updated = await updateNote(selectedId, { title: editTitle, body: editBody })
    setNotes(prev => prev.map(n => n.id === selectedId ? updated : n))
    setDirty(false)
  }

  const handleNewNote = async () => {
    if (dirty && selectedNote) await handleSave()
    const created = await createNote({ userId: user.id, title: 'Untitled Note', body: '', tagIds: [] })
    setNotes(prev => [created, ...prev])
    setSelectedId(created.id)
    setEditTitle(created.title)
    setEditBody(created.body)
    setDirty(false)
  }

  const handleDeleteNote = async () => {
    if (!selectedNote) return
    await deleteNote(selectedId)
    const remaining = notes.filter(n => n.id !== selectedId)
    setNotes(remaining)
    if (remaining.length > 0) {
      selectNote(remaining[0])
    } else {
      setSelectedId(null)
      setEditTitle('')
      setEditBody('')
    }
  }

  const handleToggleTag = async (tagId) => {
    if (!selectedNote) return
    const newTagIds = selectedNote.tagIds.includes(tagId)
      ? selectedNote.tagIds.filter(id => id !== tagId)
      : [...selectedNote.tagIds, tagId]
    const updated = await updateNote(selectedId, { tagIds: newTagIds })
    setNotes(prev => prev.map(n => n.id === selectedId ? updated : n))
  }

  const handleRemoveTag = async (tagId) => {
    if (!selectedNote) return
    const updated = await updateNote(selectedId, { tagIds: selectedNote.tagIds.filter(id => id !== tagId) })
    setNotes(prev => prev.map(n => n.id === selectedId ? updated : n))
  }

  const handleCreateTag = async (tag) => {
    const created = await createTag(tag)
    setTags(prev => [...prev, created])
  }

  const handleDeleteTag = async (id) => {
    await deleteTag(id)
    setTags(prev => prev.filter(t => t.id !== id))
    setNotes(prev => prev.map(n => ({ ...n, tagIds: n.tagIds.filter(tid => tid !== id) })))
  }

  let filteredNotes = [...notes]
  if (search) {
    const q = search.toLowerCase()
    filteredNotes = filteredNotes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  }
  if (tagFilter) {
    filteredNotes = filteredNotes.filter(n => n.tagIds.includes(Number(tagFilter)))
  }

  const renderMarkdown = (text) => {
    if (!text) return '<p style="color: var(--muted)">Nothing to preview.</p>'
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">$1</code>')
      .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--green-mid);padding-left:12px;color:var(--muted)">$1</blockquote>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/\n/g, '<br/>')
    return html
  }

  if (loading) return <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><p style={{ color: 'var(--muted)' }}>Loading notes...</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Notes</h1>
          <p>{notes.length} note{notes.length !== 1 ? 's' : ''} · {tags.length} tag{tags.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-ghost" onClick={() => setShowTagManager(true)}>Manage Tags</button>
          <button className="btn-primary" onClick={handleNewNote}>+ New Note</button>
        </div>
      </div>

      <div className="notes-shell">
        <div className="notes-list-panel">
          <div className="notes-search-wrap">
            <Search className="notes-search-icon" size={15} />
            <input className="notes-search" placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="notes-tag-filter">
            <select className="notes-tag-select" value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
              <option value="">All Notes</option>
              {tags.map(tag => <option key={tag.id} value={tag.id}>#{tag.name}</option>)}
            </select>
          </div>
          <div className="notes-list">
            {filteredNotes.map(note => (
              <NoteListItem key={note.id} note={note} selected={note.id === selectedId} tags={tags} onClick={() => selectNote(note)} />
            ))}
            {filteredNotes.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                {search || tagFilter ? 'No matching notes.' : 'No notes yet.'}
              </div>
            )}
          </div>
        </div>

        <div className="notes-editor-panel">
          {selectedNote ? (
            <div className="note-editor">
              <div className="note-editor-header">
                <input
                  className="note-title-input"
                  value={editTitle}
                  onChange={e => { setEditTitle(e.target.value); setDirty(true) }}
                  placeholder="Note title..."
                />
                <div className="note-editor-actions">
                  <div className="editor-mode-toggle">
                    <button className={`editor-mode-btn${editorMode === 'write' ? ' active' : ''}`} onClick={() => setEditorMode('write')}>Write</button>
                    <button className={`editor-mode-btn${editorMode === 'preview' ? ' active' : ''}`} onClick={() => setEditorMode('preview')}>Preview</button>
                  </div>
                  {dirty && <button className="btn-primary" onClick={handleSave}>Save</button>}
                  <button className="btn-danger" title="Delete note" onClick={handleDeleteNote}><Trash2 size={14} /></button>
                </div>
              </div>

              <div className="note-tags-row" ref={tagPickerRef}>
                {selectedTags.map(tag => (
                  <span key={tag.id} className="tag-chip" style={{ background: tag.color }}>
                    #{tag.name}
                    <button className="tag-chip-remove" onClick={() => handleRemoveTag(tag.id)}>✕</button>
                  </span>
                ))}
                <button className="tag-add-btn" onClick={() => setTagPickerOpen(!tagPickerOpen)}>+ Tag</button>
                {tagPickerOpen && (
                  <div className="tag-picker">
                    {tags.map(tag => (
                      <div key={tag.id} className={`tag-picker-item${selectedNote.tagIds.includes(tag.id) ? ' selected' : ''}`} onClick={() => handleToggleTag(tag.id)}>
                        <span className="tag-picker-dot" style={{ background: tag.color }} />
                        #{tag.name}
                        {selectedNote.tagIds.includes(tag.id) && <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>✓</span>}
                      </div>
                    ))}
                    {tags.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: '13px' }}>No tags. Use Manage Tags to create some.</div>}
                  </div>
                )}
              </div>

              {editorMode === 'write' ? (
                <>
                  <textarea
                    className="note-body-input"
                    value={editBody}
                    onChange={e => { setEditBody(e.target.value); setDirty(true) }}
                    placeholder="Start writing your note..."
                  />
                  <div className="note-markdown-hint">
                    <strong>Markdown:</strong>
                    &nbsp;## Heading &nbsp;·&nbsp; **bold** &nbsp;·&nbsp; *italic*
                    &nbsp;·&nbsp; - list &nbsp;·&nbsp; {'>'} quote &nbsp;·&nbsp; `code`
                  </div>
                </>
              ) : (
                <div className="note-preview-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(editBody) }} />
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <h3>No note selected</h3>
              <p>Select a note from the list or create a new one.</p>
            </div>
          )}
        </div>
      </div>

      {showTagManager && (
        <TagManagerModal tags={tags} onCreateTag={handleCreateTag} onDeleteTag={handleDeleteTag} onClose={() => setShowTagManager(false)} />
      )}
    </div>
  )
}
