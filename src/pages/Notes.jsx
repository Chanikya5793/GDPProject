import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { getNotes, createNote, updateNote, deleteNote, getTags, createTag, updateTag, deleteTag } from '../api/notes'
import { Search, Trash2, X, PinIcon, Paperclip, Download, File as FileIcon } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import '../css/Notes.css'

const TAG_COLORS = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#F3E8FF', '#FEE2E2', '#E0E7FF', '#CCFBF1']

// Attachments are stored as data URLs inside the note (browser localStorage),
// so we cap individual file size to stay well within storage limits.
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024 // 2 MB

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function makeAttachmentId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function NoteListItem({ note, selected, tags, isPinned, onClick }) {
  const preview = note.body.replace(/[#*_`>\-\[\]]/g, '').slice(0, 80)
  const noteTags = tags.filter(t => note.tagIds.includes(t.id))

  return (
    <div className={`note-list-item${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="note-list-title">
        {isPinned && <PinIcon size={11} className="note-list-pin-icon" />}
        {note.title || 'Untitled'}
      </div>
      {preview && <div className="note-list-preview">{preview}…</div>}
      <div className="note-list-meta">
        <span className="note-list-date">
          {note.attachments?.length > 0 && (
            <Paperclip size={11} style={{ verticalAlign: '-1px', marginRight: '3px' }} />
          )}
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

/* A row of preset swatches plus a native color picker for any custom color. */
function ColorChooser({ value, onChange }) {
  return (
    <div className="tag-color-chooser">
      {TAG_COLORS.map(c => (
        <button
          key={c}
          type="button"
          className={`tag-color-swatch${value?.toLowerCase() === c.toLowerCase() ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          title={c}
        />
      ))}
      <label className="tag-color-custom" title="Custom color" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="tag-color-custom-plus">+</span>
      </label>
    </div>
  )
}

function TagManagerModal({ tags, onCreateTag, onUpdateTag, onDeleteTag, onClose }) {
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
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Manage Tags</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="tag-manager-create">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="New tag name..." onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1 }} />
            <button className="btn-primary" onClick={handleAdd} style={{ whiteSpace: 'nowrap' }}>Add</button>
          </div>
          <ColorChooser value={newColor} onChange={setNewColor} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          {tags.map(tag => (
            <div key={tag.id} className="tag-manager-row">
              <div className="tag-manager-row-head">
                <span className="tag-chip" style={{ background: tag.color }}>#{tag.name}</span>
                <button className="btn-icon btn-icon-danger" style={{ width: '24px', height: '24px', marginLeft: 'auto' }} onClick={() => onDeleteTag(tag.id)} title="Delete tag">
                  <Trash2 size={12} />
                </button>
              </div>
              <ColorChooser value={tag.color} onChange={c => onUpdateTag(tag.id, { color: c })} />
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
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pinnedNoteIds, setPinnedNoteIds] = useState(() => {
    try {
      const saved = localStorage.getItem('nw_pinned_notes')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const tagPickerRef = useRef(null)
  const attachInputRef = useRef(null)

  const handlePinToDashboard = (noteId) => {
    setPinnedNoteIds(prev => {
      const next = prev.includes(noteId)
        ? prev.filter(id => id !== noteId)
        : [...prev, noteId]
      localStorage.setItem('nw_pinned_notes', JSON.stringify(next))
      return next
    })
  }

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

  const selectNote = async (note) => {
    if (dirty && selectedNote) {
      await handleSave()
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
    setConfirmDeleteNote(false)
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

  const handleAttachFiles = async (fileList) => {
    if (!selectedNote) return
    const files = Array.from(fileList)
    const newAtts = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        alert(`"${file.name}" is larger than 2 MB and can't be attached. Attachments are stored in your browser, so please use smaller files.`)
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        newAtts.push({
          id: makeAttachmentId(),
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl,
        })
      } catch {
        alert(`Could not read "${file.name}".`)
      }
    }
    if (newAtts.length === 0) return
    const attachments = [...(selectedNote.attachments || []), ...newAtts]
    try {
      const updated = await updateNote(selectedId, { attachments })
      setNotes(prev => prev.map(n => n.id === selectedId ? updated : n))
    } catch {
      alert('There is not enough browser storage to save these attachments. Try smaller files or remove some existing ones.')
    }
  }

  const handleRemoveAttachment = async (attId) => {
    if (!selectedNote) return
    const attachments = (selectedNote.attachments || []).filter(a => a.id !== attId)
    const updated = await updateNote(selectedId, { attachments })
    setNotes(prev => prev.map(n => n.id === selectedId ? updated : n))
  }

  const handleUpdateTag = async (id, updates) => {
    const updated = await updateTag(id, updates)
    setTags(prev => prev.map(t => t.id === id ? updated : t))
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
      .replace(/`(.+?)`/g, '<code class="ai-inline-code">$1</code>')
      .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--green-mid);padding-left:12px;color:var(--muted)">$1</blockquote>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/\n/g, '<br/>')
    // Wrap consecutive <li> runs in <ul>
    html = html.replace(/((?:<li>.*?<\/li>(?:<br\/?>)*)+)/g, '<ul>$1</ul>')
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
              <NoteListItem key={note.id} note={note} selected={note.id === selectedId} tags={tags} isPinned={pinnedNoteIds.includes(note.id)} onClick={() => selectNote(note)} />
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
                  <button
                    className={`note-pin-btn${pinnedNoteIds.includes(selectedId) ? ' pinned' : ''}`}
                    onClick={() => handlePinToDashboard(selectedId)}
                    title={pinnedNoteIds.includes(selectedId) ? 'Unpin from Dashboard' : 'Pin to Dashboard'}
                  >
                    <PinIcon size={14} />
                    {pinnedNoteIds.includes(selectedId) ? 'Pinned' : 'Pin to Dashboard'}
                  </button>
                  <div className="editor-mode-toggle">
                    <button className={`editor-mode-btn${editorMode === 'write' ? ' active' : ''}`} onClick={() => setEditorMode('write')}>Write</button>
                    <button className={`editor-mode-btn${editorMode === 'preview' ? ' active' : ''}`} onClick={() => setEditorMode('preview')}>Preview</button>
                  </div>
                  {dirty && <button className="btn-primary" onClick={handleSave}>Save</button>}
                  <button className="btn-danger" title="Delete note" onClick={() => setConfirmDeleteNote(true)}><Trash2 size={14} /></button>
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

              <div className="note-attachments">
                <div className="note-attachments-head">
                  <button className="attach-add-btn" onClick={() => attachInputRef.current?.click()}>
                    <Paperclip size={13} /> Attach file
                  </button>
                  <input
                    ref={attachInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => { handleAttachFiles(e.target.files); e.target.value = '' }}
                  />
                  {(selectedNote.attachments?.length > 0) && (
                    <span className="note-attachments-count">{selectedNote.attachments.length} attached</span>
                  )}
                </div>
                {selectedNote.attachments?.length > 0 && (
                  <div className="note-attachments-list">
                    {selectedNote.attachments.map(att => (
                      <div key={att.id} className="note-attachment">
                        {att.type?.startsWith('image/') ? (
                          <a href={att.dataUrl} download={att.name} className="note-attachment-thumb" title={`Download ${att.name}`}>
                            <img src={att.dataUrl} alt={att.name} />
                          </a>
                        ) : (
                          <span className="note-attachment-icon"><FileIcon size={18} /></span>
                        )}
                        <div className="note-attachment-info">
                          <a href={att.dataUrl} download={att.name} className="note-attachment-name" title={att.name}>{att.name}</a>
                          <span className="note-attachment-size">{formatFileSize(att.size)}</span>
                        </div>
                        <a href={att.dataUrl} download={att.name} className="note-attachment-dl" title="Download"><Download size={14} /></a>
                        <button className="note-attachment-rm" onClick={() => handleRemoveAttachment(att.id)} title="Remove"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {editorMode === 'write' ? (
                <>
                  <textarea
                    className="note-body-input"
                    value={editBody}
                    onChange={e => { setEditBody(e.target.value); setDirty(true) }}
                    placeholder={`Start writing your note...\n\nTip: You can use markdown formatting:\n     ## Heading\n     **bold**  *italic*\n     - bullet list\n     > blockquote`}
                    spellCheck
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
        <TagManagerModal tags={tags} onCreateTag={handleCreateTag} onUpdateTag={handleUpdateTag} onDeleteTag={handleDeleteTag} onClose={() => setShowTagManager(false)} />
      )}

      {confirmDeleteNote && selectedNote && (
        <ConfirmDialog
          title="Delete note?"
          message={`"${selectedNote.title || 'Untitled'}" will be moved to the Recycle Bin. You can restore it later from Settings.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteNote}
          onClose={() => setConfirmDeleteNote(false)}
        />
      )}
    </div>
  )
}
