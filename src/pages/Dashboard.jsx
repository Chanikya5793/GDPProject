import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getTasks, toggleTask, createTask } from "../api/tasks"
import { getReminders, createReminder } from "../api/reminders"
import { getCategories } from "../api/categories"
import { Check, Bell } from "lucide-react"
import "../css/Dashboard.css"

// HARDCODED DATA - replace with API data

const STATS = [
  {
    label: 'Overdue', value: 2,
    danger: true
  },
  { 
    label: 'Due Today',
    value: 3,
    danger: false
  },
  {
    label: 'This Week',
    value: 8,
    danger: false
  },
  {
    label: 'Completed',
    value: 12,
    danger: false,
    success: true
  },
]

const OVERDUE_TASKS = [
  {
    id: 1,
    title: 'Submit History Essay',
    category: 'Homework',
    priority: 'high'
  },
  {
    id: 2,
    title: 'Complete Biology Lab Report',
    category: 'Lab',
    priority: 'high' 
},
]

const TODAY_TASKS = [
  {
    id: 3,
    title: 'Read Chapter 5 - Organic Chemistry',
    category: 'Reading',
    priority: 'high'
  },
  {
    id: 4,
    title: 'CS Problem Set 3',
    category: 'Homework',
    priority: 'medium'
  },
]

const TODAY_REMINDERS = [
  {
    id: 1,
    title: 'Advisor Meeting',
    time: '10:00 AM'
  },
]

const UPCOMING = [
  {
    id: 5,
    _type: 'task',
    title: 'Study for CS Midterm',
    date: 'Thu, May 15',
    priority: 'medium'
  },
  {
    id: 2,
    _type: 'reminder',
    title: 'Study Group - Library Rm 204',
    date: 'Thu, May 15',
    time: '2:00 PM'
  },
  {
    id: 6,
    _type: 'task',
    title: 'Math Homework Chapter 7',
    date: 'Fri, May 16',
    priority: 'low'
  },
  {
    id: 3,
    _type: 'reminder',
    title: 'Office Hours - Prof. Martinez',
    date: 'Fri, May 16',
    time: '9:30 AM'
  },
  {
    id: 7,
    _type: 'task',
    title: 'Research Paper Draft', 
    date: 'Sat, May 17',
    priority: 'high'
  },
]

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

// MAIN PAGE
export default function Dashboard() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [reminders, setReminders] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState([true])
  const [quickMode, setQuickMode] = useState([null])

  // QUICK ADD STATE
  const [qTitle, setQTitle] = useState('')
  const [qDate, setQDate] = useState(today())
  const [qTime, setQTime] = useState('09:00')
  const [qPriority, setQPriority] = useState('medium')
  const [qCategory, setQCategory] = useState('')

  useEffect(() => {
    async function load() {
      const [t, r, c] = await Promise.all([
        getTasks(user.id),
        getReminders(user.id),
        getCategories(user.id),
      ])
      setTasks(t)
      setReminders(r)
      setCategories(c)
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

  // MERGE UPCOMING TASKS & REMINDERS
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
  
  const handleQuickAdd = async (e) => {
    e.preventDefault()
    if (!qTitle.trim()) return
    if (quickMode === 'task') {
      const newTask = await createTask({
        userId: user.id,
        title: qTitle,
        dueDate: qDate,
        dueTime: qTime,
        priority: qPriority,
        category: qCategory,
        notes: '',
      })
      setTasks(prev => [...prev, newTask])
    } else {
      const newReminder = await createReminder({
        userId: user.id,
        title: qTitle,
        date: qDate,
        time: qTime,
        notes: '',
      })
      setReminders(prev => [...prev, newReminder])
    }
    setQTitle('')
    setQDate(today())
    setQTime('09:00')
    setQCategory(categories[0]?.name || '')
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
      {/* PAGE HEADER - greeting + quick add buttons */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>{greeting}, {firstName}</h1>
          <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="dash-quick-btns">
          {/* These buttons will open a quick-add form */}
          <button className="btn-primary" onClick={() => setQuickMode(quickMode === 'task' ? null : 'task')}>+ Quick Task</button>
          <button className="btn-secondary" onClick={() => setQuickMode(quickMode === 'reminder' ? null : 'reminder')}>+ Quick Reminder</button>
        </div>
      </div>

      <div className="page-body">

        {/* QUICK ADD FORM */}
        {quickMode && (
          <div className="quick-add-bar card" style={{ marginBottom: '24px' }}>
            <form onSubmit={handleQuickAdd}>
              <div className="quick-add-title">
                Quick Add - {quickMode === 'task' ? 'Task' : 'Reminder'}
              </div>
              <div className="quick-add-row">
                <input
                  className="form-input"
                  placeholder={quickMode === 'task' ? 'Task title...' : 'Reminder title...'}
                  value={qTitle}
                  onChange={e => setQTitle(e.target.value)}
                  autoFocus
                  required
                  />
                  <input
                    className="form-input"
                    type="date"
                    value={qDate}
                    onChange={e => setQDate(e.target.value)}
                    required
                  />
                  {quickMode === 'task' ? (
                    <>
                      <input
                        className="form-input"
                        type="time"
                        value={qTime}
                        onChange={e => setQTime(e.target.value)}
                      />
                      <select className="form-select" value={qPriority} onChange={e => setQPriority(e.target.value)}>
                        <option value="high">High Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="low">Low Priority</option>
                      </select>
                      <select className="form-select" value={qCategory} onChange={e => setQCategory(e.target.value)}>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </>
                  ) : (
                    <input
                      className="form-input"
                      type="time"
                      value={qTime}
                      onChange={e => setQTime(e.target.value)}
                      required
                    />
                  )}
                  <button type="submit" className="btn-primary">Save</button>
                  <button type="button" className="btn-ghost" onClick={() => setQuickMode(null)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* STAT CARDS */}
        {/* Four numbers - overdue, today, week, completed */}
        <div className="dash-stats">
          <div className={`dash-stat ${overdue.length > 0 ? 'dash-stat-danger' : ''}`}>
            <div className="dash-stat-n" style={{ color: overdue.length > 0 ? 'var(--red)' : 'var(--green)' }}>
              {overdue.length}
            </div>
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

        {/* TWO COLUMN GRID */}
        <div className="dash-grid">

          {/* LEFT COLUMN - overdue + today */}
          <div className="dash-col">

            {/* OVERDUE SECTION - only shows if there are overdue tasks */}
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

            {/* DUE TODAY SECTION */}
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

          {/* RIGHT COLUMN - upcoming 7 days */}
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
    </>
  )
}

// A task row with a checkbox, title, category, and priority badge
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

// A reminder row with a bell icon, title, and time
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
