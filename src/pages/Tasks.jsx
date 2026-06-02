import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { getTasks, createTask, updateTask, deleteTask, toggleTask, batchUpdateTasks } from '../api/tasks'
import { createReminder } from '../api/reminders'
import { getCategories } from '../api/categories'
import { Pencil, Trash2, List, LayoutGrid, Check, X, Bell, ChevronDown, AlertTriangle, Shuffle } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import '../css/Tasks.css'

// ─── date helpers ────────────────────────────────────────────────────────────

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function today() { return localDateStr() }

function getDaysUntilDue(dueDateStr) {
  if (!dueDateStr) return Infinity
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr + 'T00:00:00')
  return Math.floor((due - t) / 86400000)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const todayStr = today()
  const tom = new Date(); tom.setDate(tom.getDate() + 1)
  const tomorrowStr = localDateStr(tom)
  if (dateStr === todayStr) return 'Today'
  if (dateStr === tomorrowStr) return 'Tomorrow'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function friendlyDate(dateStr) {
  const d = getDaysUntilDue(dateStr)
  if (d < 0) return 'Overdue'
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

// ─── priority escalation ─────────────────────────────────────────────────────

const PRIO_ORDER = { high: 0, medium: 1, low: 2 }

/**
 * Returns the effective (display) priority based on deadline proximity.
 * Stored priority is NEVER changed — only the visual representation escalates.
 *
 * Rules (incomplete tasks with a due date only):
 *   overdue / today (≤ 0 days)  →  any priority  →  HIGH
 *   tomorrow         (1 day)    →  any priority  →  HIGH
 *   2–4 days                    →  low            →  MEDIUM
 */
function getEffectivePriority(task) {
  if (task.completed || !task.dueDate) return { effective: task.priority || 'medium', original: task.priority || 'medium', wasEscalated: false, daysUntilDue: Infinity }
  const days = getDaysUntilDue(task.dueDate)
  const original = task.priority || 'medium'
  let effective = original
  if (days <= 1) {
    effective = 'high'
  } else if (days <= 4) {
    if (original === 'low') effective = 'medium'
  }
  return { effective, original, wasEscalated: effective !== original, daysUntilDue: days }
}

// ─── overload detection & pull-forward rescheduling ──────────────────────────

/**
 * Finds future dates (> today) with >= threshold incomplete tasks.
 * Today and overdue dates are excluded — you can't pull those any earlier.
 */
function detectOverloadedDays(tasks, threshold = 3) {
  const todayStr = today()
  const active = tasks.filter(t => !t.completed && t.dueDate && t.dueDate > todayStr)
  const byDate = {}
  for (const t of active) {
    byDate[t.dueDate] = byDate[t.dueDate] || []
    byDate[t.dueDate].push(t)
  }
  return Object.entries(byDate)
    .filter(([, ts]) => ts.length >= threshold)
    .map(([date, ts]) => ({ date, tasks: ts }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * For each overloaded future day, suggests PULLING lower-priority tasks
 * FORWARD to earlier available dates (between today+1 and the overloaded day-1).
 * Never pushes tasks to a later date.
 *
 * Strategy: keep the `keepPerDay` highest-priority tasks on the original date;
 * move the rest to the earliest available slot before that date.
 */
function suggestReschedule(overloadedDays, allTasks, keepPerDay = 2) {
  const todayStr = today()

  // Build a mutable count map for all active tasks (so we can reserve slots)
  const countByDate = {}
  for (const t of allTasks.filter(t => !t.completed && t.dueDate)) {
    countByDate[t.dueDate] = (countByDate[t.dueDate] || 0) + 1
  }

  const suggestions = []

  for (const day of overloadedDays) {
    // Sort: highest stored priority first, then oldest creation date first
    const sorted = [...day.tasks].sort((a, b) =>
      PRIO_ORDER[a.priority] !== PRIO_ORDER[b.priority]
        ? PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]
        : new Date(a.createdAt) - new Date(b.createdAt)
    )

    // Keep top keepPerDay tasks; suggest pulling the rest EARLIER
    const toMove = sorted.slice(keepPerDay)

    for (const task of toMove) {
      const overloadedDate = new Date(day.date + 'T00:00:00')
      let targetStr = null

      // Search BACKWARDS from (overloaded day - 1) to (today + 1)
      for (let offset = 1; offset < getDaysUntilDue(day.date); offset++) {
        const candidate = new Date(overloadedDate)
        candidate.setDate(candidate.getDate() - offset)
        const candStr = localDateStr(candidate)
        if (candStr <= todayStr) break // don't go to today or past
        const existing = countByDate[candStr] || 0
        if (existing < keepPerDay) {
          targetStr = candStr
          countByDate[candStr] = existing + 1
          break
        }
      }

      if (targetStr) {
        suggestions.push({ task, from: day.date, to: targetStr })
      }
    }
  }

  return suggestions
}

// ─── existing UI helpers (unchanged) ─────────────────────────────────────────

const PRIORITY_STYLES = {
  high:   { bg: '#FFA6A6', border: '#E68E8E' },
  medium: { bg: '#FFEFB5', border: '#F4DAB2' },
  low:    { bg: '#E2FFAF', border: '#CEFFB0' },
  // overdue tasks render in a muted gray (past-due); the red left border + ⚠ still flag them
  escalated: { bg: '#E5E7EB', border: '#D1D5DB' },
}
const DONE_STYLE = { bg: '#F9FAFB', border: '#E5E7EB', accent: '#9CA3AF' }

function getUrgencyClass(task, alertsEnabled) {
  if (task.completed || !task.dueDate || !alertsEnabled) return ''
  const todayStr = today()
  const tom = new Date(); tom.setDate(tom.getDate() + 1)
  const tomorrowStr = localDateStr(tom)
  if (task.dueDate < todayStr) return ' task-alert-overdue'
  if (task.dueDate === todayStr || task.dueDate === tomorrowStr) return ' task-alert-nearing'
  return ''
}

// ─── FilterDropdown (unchanged) ──────────────────────────────────────────────

function FilterDropdown({ value, options, onChange }) {
  return (
    <div className="filter-dd">
      <div className="filter-dd-btn">
        {options.find(o => o.value === value)?.label || value}
        <ChevronDown size={12} />
      </div>
      <div className="filter-dd-menu">
        <div className="filter-dd-menu-inner">
          {options.map(o => (
            <div key={o.value} className={`filter-dd-opt${o.value === value ? ' active' : ''}`}
              onClick={() => onChange(o.value)}>
              {o.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── TaskModal (unchanged) ────────────────────────────────────────────────────

function TaskModal({ task, categories, onSave, onClose, defaultPriority, defaultCategory }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    dueDate: task?.dueDate || today(),
    dueTime: task?.dueTime || '',
    priority: task?.priority || defaultPriority || 'medium',
    category: task?.category || defaultCategory || 'Homework',
    notes: task?.notes || '',
  })
  const [addReminders, setAddReminders] = useState(false)
  const [reminders, setReminders] = useState([{ date: task?.dueDate || today(), time: task?.dueTime || '' }])

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const toggleReminders = (checked) => {
    setAddReminders(checked)
    if (checked && reminders.length === 0) setReminders([{ date: form.dueDate, time: form.dueTime }])
  }

  const addReminderEntry = () => setReminders(prev => [...prev, { date: form.dueDate, time: form.dueTime }])

  const updateReminderEntry = (i, field, value) =>
    setReminders(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))

  const removeReminderEntry = (i) => {
    const next = reminders.filter((_, idx) => idx !== i)
    if (next.length === 0) { setAddReminders(false); setReminders([{ date: form.dueDate, time: form.dueTime }]) }
    else setReminders(next)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    onSave({ ...form, reminders: addReminders ? reminders : [] })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{task ? 'Edit Task' : 'New Task'}</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="What needs to be done?" autoFocus />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Time</label>
                <input className="form-input" type="time" value={form.dueTime} onChange={e => set('dueTime', e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-select" value={form.category} onChange={e => set('category', e.target.value)}>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional details..." />
            </div>
            {!task && (
              <div className="reminder-section">
                <label className="form-checkbox">
                  <input type="checkbox" checked={addReminders} onChange={e => toggleReminders(e.target.checked)} />
                  <Bell size={14} />
                  <span>Also create reminders</span>
                </label>
                {addReminders && (
                  <div className="reminder-entries">
                    {reminders.map((rem, i) => (
                      <div key={i} className="reminder-entry">
                        <input type="date" className="form-input" value={rem.date} onChange={e => updateReminderEntry(i, 'date', e.target.value)} />
                        <input type="time" className="form-input" value={rem.time} onChange={e => updateReminderEntry(i, 'time', e.target.value)} />
                        <button type="button" className="btn-icon btn-icon-danger" onClick={() => removeReminderEntry(i)} title="Remove"><X size={14} /></button>
                      </div>
                    ))}
                    <button type="button" className="reminder-add-btn" onClick={addReminderEntry}>+ Add another reminder</button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">{task ? 'Save Changes' : 'Add Task'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── TaskCard (updated: escalation badges, fixed overdue color) ───────────────

function TaskCard({ task, onToggle, onEdit, onDelete, dueDateAlerts }) {
  const isOverdue = !task.completed && task.dueDate && task.dueDate < today()
  const ep = getEffectivePriority(task)
  // Overdue → muted gray "past-due" card (the red left border + ⚠ flag it);
  // upcoming tasks use their effective (possibly escalated) priority color.
  const styleKey = isOverdue ? 'escalated' : ep.effective
  const colors = task.completed ? DONE_STYLE : (PRIORITY_STYLES[styleKey] || PRIORITY_STYLES.medium)
  const urgency = getUrgencyClass(task, dueDateAlerts)

  // Escalation badge: only for UPCOMING tasks bumped by proximity (tomorrow … a few days out).
  // Overdue/today are already obvious from the ⚠ date + red border, so no badge there.
  let escalationLabel = null
  if (ep.wasEscalated && !task.completed && ep.daysUntilDue >= 1) {
    escalationLabel = ep.daysUntilDue === 1 ? 'tmr' : `${ep.daysUntilDue}d`
  }

  return (
    <div className="task-card-slot">
      <div
        className={`task-card${task.completed ? ' task-done' : ` task-priority-${styleKey}${ep.wasEscalated && !isOverdue ? ' task-escalated' : ''}`}${urgency}`}
        onMouseDown={e => { if (e.detail > 1) e.preventDefault() }}
        onDoubleClick={e => { if (!e.target.closest('button')) onEdit(task) }}
        title="Double-click to edit"
        style={{
          background: colors.bg,
          borderTopColor: colors.border,
          borderRightColor: colors.border,
          borderBottomColor: colors.border,
          borderLeftColor: isOverdue ? '#DC2626' : colors.border,
          borderLeftWidth: isOverdue ? 4 : 1,
        }}
      >
        {/* Compact row */}
        <div className="task-card-compact">
          <div className="task-card-title-row">
            <div className="task-card-title">{task.title}</div>
            {escalationLabel && (
              <span className="task-escalation-badge">↑ {escalationLabel}</span>
            )}
          </div>
          <span className={`task-date-compact${isOverdue ? ' overdue' : ''}`}>
            {isOverdue && '⚠ '}{formatDate(task.dueDate)}
          </span>
        </div>

        {/* Expanded details */}
        <div className="task-card-details">
          <div className="task-card-details-inner">
            <div className="task-card-reveal-top">
              <button className={`task-check${task.completed ? ' checked' : ''}`} onClick={() => onToggle(task.id)}>
                {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
              </button>
              <div className="task-card-reveal-info">
                <div className="task-card-meta">
                  {task.dueDate && (
                    <span className={`task-date${isOverdue ? ' overdue' : ''}`}>
                      {isOverdue ? '⚠ Overdue · ' : ''}{formatDate(task.dueDate)}
                      {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}
                    </span>
                  )}
                  {task.category && <span className="task-cat">{task.category}</span>}
                  <span className={`task-priority-badge${ep.wasEscalated && !task.completed && !isOverdue ? ' escalated' : ''}`}>
                    {isOverdue ? (task.priority || 'medium') : ep.effective}{ep.wasEscalated && !task.completed && !isOverdue ? ' ↑' : ''}
                  </span>
                </div>
              </div>
              <div className="task-card-actions">
                <button className="btn-icon" title="Edit" onClick={() => onEdit(task)}><Pencil size={14} /></button>
                <button className="btn-icon btn-icon-danger" title="Delete" onClick={() => onDelete(task.id)}><Trash2 size={14} /></button>
              </div>
            </div>
            {task.notes && <div className="task-notes">{task.notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── RescheduleModal ──────────────────────────────────────────────────────────

function RescheduleModal({ overloadedDays, suggestions, onApply, onClose }) {
  const [accepted, setAccepted] = useState(() => new Set(suggestions.map(s => s.task.id)))

  const toggle = (id) => setAccepted(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const acceptedList = suggestions.filter(s => accepted.has(s.task.id))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal reschedule-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Shuffle size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Optimize Schedule
          </h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="reschedule-info-box">
          <AlertTriangle size={15} />
          <span>
            {overloadedDays.length === 1
              ? `${overloadedDays[0].tasks.length} tasks are due on ${friendlyDate(overloadedDays[0].date)}.`
              : `${overloadedDays.length} days have 3+ tasks due.`
            }
            {' '}High-priority tasks stay; lower-priority ones can be pulled to earlier free days.
          </span>
        </div>

        {/* Overloaded days summary */}
        {overloadedDays.map(day => {
          const ep_tasks = day.tasks.map(t => ({ t, ep: getEffectivePriority(t) }))
          return (
            <div key={day.date} className="reschedule-day-block">
              <div className="reschedule-day-header">
                <strong>{friendlyDate(day.date)}</strong>
                <span className="reschedule-day-count">{day.tasks.length} tasks due</span>
              </div>
              <ul className="reschedule-day-tasks">
                {ep_tasks.map(({ t, ep }) => (
                  <li key={t.id}>
                    {t.title}
                    {ep.wasEscalated && <span className="reschedule-escalated-tag">↑ escalated</span>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {suggestions.length > 0 ? (
          <>
            <p className="reschedule-section-label">SUGGESTED MOVES — pulled to earlier free days</p>
            <div className="reschedule-suggestions">
              {suggestions.map(s => {
                const isOn = accepted.has(s.task.id)
                return (
                  <label key={s.task.id} className={`reschedule-suggestion${isOn ? ' selected' : ''}`}>
                    <input type="checkbox" checked={isOn} onChange={() => toggle(s.task.id)} />
                    <div className="reschedule-suggestion-body">
                      <span className="reschedule-task-title">{s.task.title}</span>
                      <span className="reschedule-move-row">
                        <span className="reschedule-from">{friendlyDate(s.from)}</span>
                        <span className="reschedule-arrow">→</span>
                        <span className="reschedule-to">{friendlyDate(s.to)}</span>
                      </span>
                    </div>
                    <span className={`reschedule-prio-dot prio-${s.task.priority}`} />
                  </label>
                )
              })}
            </div>

            <div className="reschedule-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary"
                disabled={acceptedList.length === 0}
                onClick={() => onApply(acceptedList)}
              >
                <Shuffle size={14} />
                Pull {acceptedList.length} Task{acceptedList.length !== 1 ? 's' : ''} Earlier
              </button>
            </div>
          </>
        ) : (
          <div className="reschedule-empty">
            <p>No earlier free slots found within the next 14 days. Try adding tasks to earlier dates manually.</p>
            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── main Tasks page ──────────────────────────────────────────────────────────

export default function Tasks() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [tasks, setTasks] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('grid')
  const [statusFilter, setStatusFilter] = useState('active')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState('dueDate')
  const [modalTask, setModalTask] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [showReschedule, setShowReschedule] = useState(false)

  useEffect(() => {
    Promise.all([getTasks(user.id), getCategories(user.id)]).then(([t, c]) => {
      setTasks(t)
      setCategories(c)
      setLoading(false)
    })
  }, [user.id])

  const handleToggle = async (id) => {
    const updated = await toggleTask(id)
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
  }

  const handleSave = async (form) => {
    const { reminders: remindersList = [], ...taskData } = form
    if (modalTask) {
      const updated = await updateTask(modalTask.id, taskData)
      setTasks(prev => prev.map(t => t.id === modalTask.id ? updated : t))
    } else {
      const created = await createTask({ ...taskData, userId: user.id })
      setTasks(prev => [...prev, created])
      for (const rem of remindersList) {
        await createReminder({ userId: user.id, title: taskData.title, date: rem.date, time: rem.time, notes: '' })
      }
    }
    setShowModal(false)
    setModalTask(null)
  }

  const handleDelete = async () => {
    const id = confirmDeleteId
    await deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    setConfirmDeleteId(null)
  }

  const handleEdit = (task) => { setModalTask(task); setShowModal(true) }

  const handleApplyReschedule = async (acceptedSuggestions) => {
    const updates = acceptedSuggestions.map(s => ({ id: s.task.id, changes: { dueDate: s.to } }))
    const updatedTasks = await batchUpdateTasks(updates)
    setTasks(prev => prev.map(t => {
      const hit = updatedTasks.find(u => u.id === t.id)
      return hit || t
    }))
    setShowReschedule(false)
  }

  // ── filtering & sorting ──
  const todayStr = today()
  let filtered = [...tasks]
  if (!settings.showCompleted && statusFilter === 'all') filtered = filtered.filter(t => !t.completed)
  else if (statusFilter === 'active') filtered = filtered.filter(t => !t.completed)
  else if (statusFilter === 'completed') filtered = filtered.filter(t => t.completed)
  if (priorityFilter !== 'all') filtered = filtered.filter(t => t.priority === priorityFilter)
  if (categoryFilter !== 'all') filtered = filtered.filter(t => t.category === categoryFilter)
  filtered.sort((a, b) => {
    if (sortBy === 'dueDate') return (a.dueDate || '').localeCompare(b.dueDate || '')
    if (sortBy === 'priority') return (PRIO_ORDER[a.priority] ?? 3) - (PRIO_ORDER[b.priority] ?? 3)
    return a.title.localeCompare(b.title)
  })

  const activeCount = tasks.filter(t => !t.completed).length
  const completedCount = tasks.filter(t => t.completed).length
  const overdueCount = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length

  // ── overload detection (future days only) ──
  const overloadedDays = statusFilter !== 'completed' ? detectOverloadedDays(tasks) : []
  const rescheduleSuggestions = overloadedDays.length > 0 ? suggestReschedule(overloadedDays, tasks) : []

  const usedCategories = [...new Set(tasks.map(t => t.category).filter(Boolean))]

  if (loading) return (
    <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--muted)' }}>Loading tasks...</p>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Tasks</h1>
          <p>
            {activeCount} active · {completedCount} completed
            {overdueCount > 0 && <span style={{ color: 'var(--red)', marginLeft: '4px' }}> · {overdueCount} overdue</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn-primary" onClick={() => { setModalTask(null); setShowModal(true) }}>+ Add Task</button>
          <div className="view-toggle">
            <button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`} title="List view" onClick={() => setView('list')}><List size={16} /></button>
            <button className={`view-toggle-btn${view === 'grid' ? ' active' : ''}`} title="Grid view" onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* ── Overload banner (future days only) ── */}
        {overloadedDays.length > 0 && (
          <button className="overload-banner" onClick={() => setShowReschedule(true)}>
            <AlertTriangle size={15} className="overload-banner-icon" />
            <div className="overload-banner-text">
              <strong>
                {overloadedDays.length === 1
                  ? `${overloadedDays[0].tasks.length} tasks due on ${friendlyDate(overloadedDays[0].date)}`
                  : `${overloadedDays.reduce((s, d) => s + d.tasks.length, 0)} tasks across ${overloadedDays.length} busy days`
                }
              </strong>
              <span>Pull some tasks to earlier free days · {rescheduleSuggestions.length} suggestion{rescheduleSuggestions.length !== 1 ? 's' : ''}</span>
            </div>
            <span className="overload-banner-cta">Optimize →</span>
          </button>
        )}

        {/* ── Filter bar ── */}
        <div className="task-filter-bar">
          <div className="task-filter-group">
            <span className="task-filter-label">Status</span>
            <FilterDropdown value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' },
            ]} />
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Priority</span>
            <FilterDropdown value={priorityFilter} onChange={setPriorityFilter} options={[
              { value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
            ]} />
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Category</span>
            <FilterDropdown value={categoryFilter} onChange={setCategoryFilter} options={[
              { value: 'all', label: 'All Categories' }, ...usedCategories.map(c => ({ value: c, label: c })),
            ]} />
          </div>
          <div className="task-filter-group" style={{ marginLeft: 'auto' }}>
            <span className="task-filter-label">Sort</span>
            <FilterDropdown value={sortBy} onChange={setSortBy} options={[
              { value: 'dueDate', label: 'Due Date' }, { value: 'priority', label: 'Priority' }, { value: 'title', label: 'Title' },
            ]} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <h3>No tasks found</h3>
            <p>Try adjusting your filters or add a new task.</p>
          </div>
        ) : (
          <div className={view === 'grid' ? 'task-grid' : 'task-list'}>
            {filtered.map(task => (
              <TaskCard key={task.id} task={task} onToggle={handleToggle} onEdit={handleEdit} onDelete={setConfirmDeleteId} dueDateAlerts={settings.dueDateAlerts} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <TaskModal
          task={modalTask}
          categories={categories}
          defaultPriority={settings.defaultPriority}
          defaultCategory={settings.defaultCategory}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setModalTask(null) }}
        />
      )}

      {confirmDeleteId !== null && (
        <ConfirmDialog
          title="Delete task?"
          message={`"${tasks.find(t => t.id === confirmDeleteId)?.title || 'This task'}" will be moved to the Recycle Bin. You can restore it later from Settings.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onClose={() => setConfirmDeleteId(null)}
        />
      )}

      {showReschedule && (
        <RescheduleModal
          overloadedDays={overloadedDays}
          suggestions={rescheduleSuggestions}
          onApply={handleApplyReschedule}
          onClose={() => setShowReschedule(false)}
        />
      )}
    </>
  )
}
