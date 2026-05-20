import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getTasks, createTask, updateTask, deleteTask, toggleTask } from '../api/tasks'
import { createReminder } from '../api/reminders'
import { getCategories } from '../api/categories'
import { Pencil, Trash2, List, LayoutGrid, Check, X, Bell } from 'lucide-react'
import '../css/Tasks.css'

function today() {
  return new Date().toISOString().split('T')[0]
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
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

function TaskModal({ task, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    dueDate: task?.dueDate || today(),
    dueTime: task?.dueTime || '',
    priority: task?.priority || 'medium',
    category: task?.category || 'Homework',
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

function TaskCard({ task, onToggle, onEdit, onDelete }) {
  const isOverdue = !task.completed && task.dueDate < today()

  return (
    <div className={`task-card${task.completed ? ' task-done' : ''}${isOverdue ? ' task-overdue' : ''}`}>
      <div className="task-card-top">
        <button className={`task-check${task.completed ? ' checked' : ''}`} onClick={() => onToggle(task.id)}>
          {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
        </button>
        <div className="task-card-body">
          <div className="task-card-title">{task.title}</div>
          <div className="task-card-meta">
            {task.dueDate && (
              <span className={`task-date${isOverdue ? ' overdue' : ''}`}>
                {isOverdue ? '⚠ Overdue · ' : ''}{formatDate(task.dueDate)}
                {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}
              </span>
            )}
            {task.category && <span className="task-cat">{task.category}</span>}
            <span className={`badge badge-${task.completed ? 'done' : task.priority}`}>{task.completed ? 'done' : task.priority}</span>
          </div>
          {task.notes && <div className="task-notes">{task.notes}</div>}
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
    </div>
  )
}

export default function Tasks() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('grid')
  const [statusFilter, setStatusFilter] = useState('all')
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
  if (statusFilter === 'active') filtered = filtered.filter(t => !t.completed)
  if (statusFilter === 'completed') filtered = filtered.filter(t => t.completed)
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
            {['all', 'active', 'completed'].map(s => (
              <button key={s} className={`filter-pill${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Priority</span>
            {['all', 'high', 'medium', 'low'].map(p => (
              <button key={p} className={`filter-pill${priorityFilter === p ? ' active' : ''}`} onClick={() => setPriorityFilter(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Category</span>
            <select className="form-select" style={{ padding: '5px 10px', fontSize: '13px', width: 'auto' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {usedCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="task-filter-group" style={{ marginLeft: 'auto' }}>
            <span className="task-filter-label">Sort</span>
            <select className="form-select" style={{ padding: '5px 10px', fontSize: '13px', width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="dueDate">Due Date</option>
              <option value="priority">Priority</option>
              <option value="title">Title</option>
            </select>
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
          onSave={handleSave}
          onClose={() => { setShowModal(false); setModalTask(null) }}
        />
      )}
    </>
  )
}
