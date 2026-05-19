import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getTasks, toggleTask, createTask } from "../api/tasks"
import { getReminders, createReminder } from "../api/reminders"
import { Check, Bell, X } from "lucide-react"
import "../css/Dashboard.css"

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 || 12
  return `${display}:${m} ${ampm}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function QuickTaskModal({ onSave, onClose }) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [priority, setPriority] = useState('medium')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title, dueDate, priority, category: 'Homework', dueTime: '', notes: '' })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Quick Task</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Add Task</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function QuickReminderModal({ onSave, onClose }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title, date, time, notes: '' })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Quick Reminder</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you need to remember?" autoFocus />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Time</label>
                <input className="form-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Add Reminder</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const [quickMode, setQuickMode] = useState(null)

  useEffect(() => {
    async function load() {
      const [t, r] = await Promise.all([
        getTasks(user.id),
        getReminders(user.id),
      ])
      setTasks(t)
      setReminders(r)
      setLoading(false)
    }
    load()
  }, [user.id])

  const todayStr = today()
  const weekStr = daysFromNow(7)

  const overdue = tasks.filter(t => !t.completed && t.dueDate < todayStr)
  const dueToday = tasks.filter(t => !t.completed && t.dueDate === todayStr)
  const upcoming = tasks.filter(t => !t.completed && t.dueDate > todayStr && t.dueDate <= weekStr)
  const remToday = reminders.filter(r => r.date === todayStr)
  const remUpcoming = reminders.filter(r => r.date > todayStr && r.date <= weekStr)
  const completed = tasks.filter(t => t.completed).length

  const timeline = [
    ...upcoming.map(t => ({ ...t, _type: 'task' })),
    ...remUpcoming.map(r => ({ ...r, _type: 'reminder' })),
  ].sort((a, b) => {
    const aDate = a.dueDate || a.date
    const bDate = b.dueDate || b.date
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
  })

  const handleToggle = async (id) => {
    const updated = await toggleTask(id)
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
  }

  const handleQuickTask = async (form) => {
    const created = await createTask({ ...form, userId: user.id })
    setTasks(prev => [...prev, created])
    setQuickMode(null)
  }

  const handleQuickReminder = async (form) => {
    const created = await createReminder({ ...form, userId: user.id })
    setReminders(prev => [...prev, created])
    setQuickMode(null)
  }

  if (loading) return (
    <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--muted)' }}>Loading your planner...</p>
    </div>
  )

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name?.split(' ')[0] || ''

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>{greeting}, {firstName}</h1>
          <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="dash-quick-btns">
          <button className="btn-primary" onClick={() => setQuickMode('task')}>+ Quick Task</button>
          <button className="btn-secondary" onClick={() => setQuickMode('reminder')}>+ Quick Reminder</button>
        </div>
      </div>

      <div className="page-body">
        <div className="dash-stats">
          <div className={`dash-stat ${overdue.length > 0 ? 'dash-stat-danger' : ''}`}>
            <div className="dash-stat-n" style={{ color: overdue.length > 0 ? 'var(--red)' : 'var(--green)' }}>{overdue.length}</div>
            <div className="dash-stat-l">Overdue</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-n">{dueToday.length + remToday.length}</div>
            <div className="dash-stat-l">Due Today</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-n">{upcoming.length + remUpcoming.length}</div>
            <div className="dash-stat-l">This Week</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-n" style={{ color: 'var(--green)' }}>{completed}</div>
            <div className="dash-stat-l">Completed</div>
          </div>
        </div>

        <div className="dash-grid">
          <div className="dash-col">
            {overdue.length > 0 && (
              <div className="card dash-section" style={{ borderLeft: '4px solid var(--red)' }}>
                <div className="dash-section-header">
                  <span className="dash-section-title" style={{ color: 'var(--red)' }}>⚠ Overdue</span>
                  <Link to="/tasks" className="dash-section-link">View all</Link>
                </div>
                {overdue.map(task => (
                  <TaskRow key={task.id} task={task} onToggle={handleToggle} />
                ))}
              </div>
            )}

            <div className="card dash-section">
              <div className="dash-section-header">
                <span className="dash-section-title">Due Today</span>
                <Link to="/tasks" className="dash-section-link">View all tasks</Link>
              </div>
              {dueToday.length === 0 && remToday.length === 0 ? (
                <p className="dash-empty">Nothing due today - enjoy your day!</p>
              ) : (
                <>
                  {dueToday.map(task => (
                    <TaskRow key={task.id} task={task} onToggle={handleToggle} />
                  ))}
                  {remToday.map(rem => (
                    <ReminderRow key={rem.id} reminder={rem} />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="dash-col">
            <div className="card dash-section">
              <div className="dash-section-header">
                <span className="dash-section-title">Upcoming - Next 7 Days</span>
                <Link to="/calendar" className="dash-section-link">Open calendar</Link>
              </div>
              {timeline.length === 0 ? (
                <p className="dash-empty">Nothing scheduled for the next 7 days.</p>
              ) : (
                <>
                  {timeline.map(item => (
                    item._type === 'task'
                      ? <TaskRow key={`t-${item.id}`} task={item} onToggle={handleToggle} showDate />
                      : <ReminderRow key={`r-${item.id}`} reminder={item} showDate />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {quickMode === 'task' && <QuickTaskModal onSave={handleQuickTask} onClose={() => setQuickMode(null)} />}
      {quickMode === 'reminder' && <QuickReminderModal onSave={handleQuickReminder} onClose={() => setQuickMode(null)} />}
    </>
  )
}

function TaskRow({ task, onToggle, showDate = false }) {
  return (
    <div className={`dash-row${task.completed ? ' dash-row-done' : ''}`}>
      <button
        className={`dash-check${task.completed ? ' checked' : ''}`}
        onClick={() => onToggle(task.id)}
        title={task.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
      </button>
      <div className="dash-row-body">
        <div className="dash-row-title">{task.title}</div>
        <div className="dash-row-meta">
          {showDate && <span>{formatDate(task.dueDate)}</span>}
          {!showDate && task.category && <span>{task.category}</span>}
          <span className={`badge badge-${task.priority}`}>{task.priority}</span>
        </div>
      </div>
    </div>
  )
}

function ReminderRow({ reminder, showDate = false }) {
  return (
    <div className="dash-row dash-row-reminder">
      <div className="dash-bell"><Bell size={18} /></div>
      <div className="dash-row-body">
        <div className="dash-row-title">{reminder.title}</div>
        <div className="dash-row-meta">
          {showDate && <span>{formatDate(reminder.date)}</span>}
          {reminder.time && <span>{formatTime(reminder.time)}</span>}
        </div>
      </div>
    </div>
  )
}
