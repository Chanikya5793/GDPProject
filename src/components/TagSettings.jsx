import { useEffect, useState } from 'react'
import { Tags } from 'lucide-react'
import { createTag, deleteTag, getTags, updateTag } from '../api/tags'

const EMPTY = { name: '', color: '#DBEAFE' }

export default function TagSettings() {
  const [tags, setTags] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getTags().then(value => { if (active) setTags(value) })
      .catch(() => { if (active) setError('Could not load tags.') })
    return () => { active = false }
  }, [])

  async function changeTag(action) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      setEditing(null)
      setForm(EMPTY)
      setTags(await getTags())
    } catch (failure) {
      setError(failure.message || 'Could not save tags.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header"><Tags size={18} /><h2>Tags</h2></div>
      {tags === null && !error && <p role="status">Loading tags…</p>}
      {tags?.map(tag => (
        <div className="settings-row" key={tag.id}>
          <span><span aria-hidden="true" style={{ color: tag.color }}>●</span> {tag.name}</span>
          <div className="settings-profile-actions">
            <button className="btn-ghost" disabled={busy} onClick={() => {
              setEditing(tag.id)
              setForm({ name: tag.name, color: tag.color })
            }} aria-label={`Edit ${tag.name}`}>Edit</button>
            <button className="btn-ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Delete the “${tag.name}” tag from your planner?`)) void changeTag(() => deleteTag(tag.id))
            }} aria-label={`Delete ${tag.name}`}>Delete</button>
          </div>
        </div>
      ))}
      <form className="settings-profile-form" onSubmit={event => {
        event.preventDefault()
        if (!form.name.trim()) return
        const data = { ...form, name: form.name.trim() }
        void changeTag(() => editing === null ? createTag(data) : updateTag(editing, data))
      }}>
        <label className="form-group">
          <span className="form-label">{editing === null ? 'New tag name' : 'Tag name'}</span>
          <input className="form-input" value={form.name} maxLength={80} disabled={busy} required
            onChange={event => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="form-group">
          <span className="form-label">Tag color</span>
          <input type="color" value={form.color} disabled={busy}
            onChange={event => setForm({ ...form, color: event.target.value })} />
        </label>
        {error && <p role="alert" className="login-error">{error}</p>}
        <div className="settings-profile-actions">
          {editing !== null && <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
            setEditing(null)
            setForm(EMPTY)
          }}>Cancel</button>}
          <button type="submit" className="btn-primary" disabled={busy || !form.name.trim()}>
            {editing === null ? 'Add tag' : 'Save tag'}
          </button>
        </div>
      </form>
    </section>
  )
}
