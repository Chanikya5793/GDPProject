import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getReminders, createReminder, updateReminder, deleteReminder } from '../api/reminders'
import { Bell, Pencil, Trash2, List, LayoutGrid, X } from 'lucide-react'
import '../css/Reminders.css'

function today() {
  return new Date().toISOString().split('T')[0]
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${m} ${ampm}`
}

function formatGroupDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const todayStr = today()
  if (dateStr === todayStr) {
    return 'Today - ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function ReminderModal({ reminder, onSave, onClose }) {
  const [form, setForm] = useState({
    title: reminder?.title || '',
    date: reminder?.date || today(),
    time: reminder?.time || '',
    notes: reminder?.notes || '',
  })

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    onSave(form)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{reminder ? 'Edit Reminder' : 'New Reminder'}</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="What do you need to remember?" autoFocus />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Time</label>
                <input className="form-input" type="time" value={form.time} onChange={e => set('time', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional details..." />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">{reminder ? 'Save Changes' : 'Add Reminder'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ReminderCard({ reminder, onEdit, onDelete }) {
  const todayStr = today()
  const isOverdue = reminder.date < todayStr
  const isToday = reminder.date === todayStr

  return (
    <div className={`rem-card${isOverdue ? ' rem-overdue' : ''}${isToday ? ' rem-today' : ''}`}>
      <div className="rem-card-left">
        <div className="rem-bell-wrap"><Bell size={18} /></div>
        <div className="rem-time-block">
          <div className="rem-time">{formatTime(reminder.time) || '--:--'}</div>
        </div>
      </div>
      <div className="rem-card-body">
        <div className="rem-card-title">{reminder.title}</div>
        <div className="rem-card-meta">
          {isOverdue && <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: '12px' }}>⚠ Overdue</span>}
          {isToday && !isOverdue && <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '12px' }}>📅 Today</span>}
          {!isOverdue && !isToday && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Upcoming</span>}
        </div>
        {reminder.notes && <div className="rem-notes">{reminder.notes}</div>}
      </div>
      <div className="rem-card-actions">
        <button className="btn-icon" title="Edit" onClick={() => onEdit(reminder)}>
          <Pencil size={14} />
        </button>
        <button className="btn-icon btn-icon-danger" title="Delete" onClick={() => onDelete(reminder.id)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function Reminders() {
  const { user } = useAuth()
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
  const [filter, setFilter] = useState('upcoming')
  const [modalReminder, setModalReminder] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    getReminders(user.id).then(r => { setReminders(r); setLoading(false) })
  }, [user.id])

  const handleSave = async (form) => {
    if (modalReminder) {
      const updated = await updateReminder(modalReminder.id, form)
      setReminders(prev => prev.map(r => r.id === modalReminder.id ? updated : r))
    } else {
      const created = await createReminder({ ...form, userId: user.id })
      setReminders(prev => [...prev, created])
    }
    setShowModal(false)
    setModalReminder(null)
  }

  const handleDelete = async (id) => {
    await deleteReminder(id)
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  const handleEdit = (rem) => {
    setModalReminder(rem)
    setShowModal(true)
  }

  const todayStr = today()
  let filtered = [...reminders]
  if (filter === 'upcoming') filtered = filtered.filter(r => r.date >= todayStr)
  if (filter === 'past') filtered = filtered.filter(r => r.date < todayStr)

  filtered.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))

  const groups = []
  let lastDate = null
  for (const rem of filtered) {
    if (rem.date !== lastDate) {
      groups.push({ date: rem.date, reminders: [rem] })
      lastDate = rem.date
    } else {
      groups[groups.length - 1].reminders.push(rem)
    }
  }

  const totalToday = reminders.filter(r => r.date === todayStr).length
  const totalUpcoming = reminders.filter(r => r.date > todayStr).length
  const totalOverdue = reminders.filter(r => r.date < todayStr).length

  if (loading) return <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><p style={{ color: 'var(--muted)' }}>Loading reminders...</p></div>

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Reminders</h1>
          <p>
            {totalToday > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{totalToday} today · </span>}
            {totalUpcoming} upcoming
            {totalOverdue > 0 && <span style={{ color: 'var(--red)' }}> · {totalOverdue} overdue</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn-primary" onClick={() => { setModalReminder(null); setShowModal(true) }}>+ Add Reminder</button>
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`} title="List view" onClick={() => setView('list')}><List size={16} /></button>
            <button className={`view-toggle-btn${view === 'grid' ? ' active' : ''}`} title="Grid view" onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="rem-filter-bar">
          {['upcoming', 'past', 'all'].map(f => (
            <button key={f} className={`filter-pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔔</div>
            <h3>No reminders found</h3>
            <p>Try adjusting your filter or add a new reminder.</p>
          </div>
        ) : (
          <div className="rem-list">
            {groups.map(group => (
              <div key={group.date} className="rem-group">
                <div className={`rem-group-label${group.date === todayStr ? ' rem-group-today' : ''}${group.date < todayStr ? ' rem-group-past' : ''}`}>
                  {group.date < todayStr ? '⚠ ' : ''}{formatGroupDate(group.date)}
                </div>
                {view === 'grid' ? (
                  <div className="rem-grid">
                    {group.reminders.map(r => <ReminderCard key={r.id} reminder={r} onEdit={handleEdit} onDelete={handleDelete} />)}
                  </div>
                ) : (
                  group.reminders.map(r => <ReminderCard key={r.id} reminder={r} onEdit={handleEdit} onDelete={handleDelete} />)
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <ReminderModal
          reminder={modalReminder}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setModalReminder(null) }}
        />
      )}
    </>
  )
}
