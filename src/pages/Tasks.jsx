import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { getTasks, createTask, updateTask, deleteTask, toggleTask } from '../api/tasks'
import { createReminder } from '../api/reminders'
import { getCategories } from '../api/categories'
import { Pencil, Trash2, List, LayoutGrid, Check, X, Bell, ChevronDown } from 'lucide-react'
import '../css/Tasks.css'

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function today() {
  return localDateStr()
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  const todayStr = localDateStr(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = localDateStr(tomorrow)
  if (dateStr === todayStr) return 'Today'
  if (dateStr === tomorrowStr) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${m} ${ampm}`
}

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
    if (checked && reminders.length === 0) {
      setReminders([{ date: form.dueDate, time: form.dueTime }])
    }
  }

  const addReminderEntry = () => {
    setReminders(prev => [...prev, { date: form.dueDate, time: form.dueTime }])
  }

  const updateReminderEntry = (i, field, value) => {
    setReminders(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  const removeReminderEntry = (i) => {
    const next = reminders.filter((_, idx) => idx !== i)
    if (next.length === 0) {
      setAddReminders(false)
      setReminders([{ date: form.dueDate, time: form.dueTime }])
    } else {
      setReminders(next)
    }
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
                        <button type="button" className="btn-icon btn-icon-danger" onClick={() => removeReminderEntry(i)} title="Remove">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="reminder-add-btn" onClick={addReminderEntry}>
                      + Add another reminder
                    </button>
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

const PRIORITY_STYLES = {
  high:   { bg: '#FFA6A6', border: '#E68E8E' },
  medium: { bg: '#FFEFB5', border: '#F4DAB2' },
  low:    { bg: '#E2FFAF', border: '#CEFFB0' },
}
const DONE_STYLE = { bg: '#F9FAFB', border: '#E5E7EB', accent: '#9CA3AF' }

function TaskCard({ task, onToggle, onEdit, onDelete }) {
  const isOverdue = !task.completed && task.dueDate < today()
  const colors = task.completed ? DONE_STYLE : (PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium)

  return (
    <div className="task-card-slot">
      <div
        className={`task-card${task.completed ? ' task-done' : ` task-priority-${task.priority || 'medium'}`}`}
        style={{
          background: colors.bg,
          borderTopColor: colors.border,
          borderRightColor: colors.border,
          borderBottomColor: colors.border,
          borderLeftColor: isOverdue ? '#DC2626' : colors.border,
          borderLeftWidth: isOverdue ? 4 : 1,
        }}
      >
        {/* Compact row - always visible */}
        <div className="task-card-compact">
          <div className="task-card-title">{task.title}</div>
          <span className={`task-date-compact${isOverdue ? ' overdue' : ''}`}>
            {isOverdue && '⚠ '}{formatDate(task.dueDate)}
          </span>
        </div>

        {/* Details - expands on hover via grid-template-rows */}
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
                </div>
              </div>
              <div className="task-card-actions">
                <button className="btn-icon" title="Edit" onClick={() => onEdit(task)}>
                  <Pencil size={14} />
                </button>
                <button className="btn-icon btn-icon-danger" title="Delete" onClick={() => onDelete(task.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {task.notes && <div className="task-notes">{task.notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

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
        await createReminder({
          userId: user.id,
          title: taskData.title,
          date: rem.date,
          time: rem.time,
          notes: '',
        })
      }
    }
    setShowModal(false)
    setModalTask(null)
  }

  const handleDelete = async (id) => {
    await deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const handleEdit = (task) => {
    setModalTask(task)
    setShowModal(true)
  }

  const todayStr = today()
  let filtered = [...tasks]
  if (!settings.showCompleted && statusFilter === 'all') {
    filtered = filtered.filter(t => !t.completed)
  } else if (statusFilter === 'active') {
    filtered = filtered.filter(t => !t.completed)
  } else if (statusFilter === 'completed') {
    filtered = filtered.filter(t => t.completed)
  }
  if (priorityFilter !== 'all') filtered = filtered.filter(t => t.priority === priorityFilter)
  if (categoryFilter !== 'all') filtered = filtered.filter(t => t.category === categoryFilter)

  filtered.sort((a, b) => {
    if (sortBy === 'dueDate') return (a.dueDate || '').localeCompare(b.dueDate || '')
    if (sortBy === 'priority') {
      const order = { high: 0, medium: 1, low: 2 }
      return (order[a.priority] ?? 3) - (order[b.priority] ?? 3)
    }
    return a.title.localeCompare(b.title)
  })

  const activeCount = tasks.filter(t => !t.completed).length
  const completedCount = tasks.filter(t => t.completed).length
  const overdueCount = tasks.filter(t => !t.completed && t.dueDate < todayStr).length
  const usedCategories = [...new Set(tasks.map(t => t.category).filter(Boolean))]

  if (loading) return <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><p style={{ color: 'var(--muted)' }}>Loading tasks...</p></div>

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
              <TaskCard key={task.id} task={task} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
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
    </>
  )
}
