import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useAi } from "../context/AiContext"
import { getTasks, toggleTask, createTask } from "../api/tasks"
import { getReminders, createReminder } from "../api/reminders"
import { Check, Bell, X, GripVertical, RotateCcw, Bot, Send, Trash2, PanelRightOpen } from "lucide-react"
import "../css/Dashboard.css"

/* ─── Helpers ─── */

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

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function today() {
  return localDateStr()
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

/* ─── Pie Chart ─── */

const PIE_SIZE = 120
function PieChart({ data }) {
  const [hovered, setHovered] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const total = data.reduce((s, d) => s + d.value, 0)
  const size = PIE_SIZE
  const c = size / 2, r = c - 2, ir = r * 0.58

  if (total === 0) return (
    <div className="pie-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="pie-svg">
        <circle cx={c} cy={c} r={r} fill="var(--off)" stroke="var(--border)" />
        <circle cx={c} cy={c} r={ir} fill="var(--white)" />
        <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" fontSize="12">No data</text>
      </svg>
    </div>
  )

  let a = -90
  const segs = data.filter(d => d.value > 0).map(d => {
    const sw = (d.value / total) * 360, sa = a; a += sw
    if (sw >= 359.99) return { ...d, full: true, pct: 100 }
    const sr = sa * Math.PI / 180, er = (sa + sw) * Math.PI / 180
    return {
      ...d, full: false, pct: Math.round(d.value / total * 100),
      d: `M${c} ${c}L${c + r * Math.cos(sr)} ${c + r * Math.sin(sr)}A${r} ${r} 0 ${sw > 180 ? 1 : 0} 1 ${c + r * Math.cos(er)} ${c + r * Math.sin(er)}Z`
    }
  })

  return (
    <div className="pie-wrap" onMouseMove={e => { const b = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - b.left, y: e.clientY - b.top }) }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="pie-svg">
        {segs.map((s, i) => s.full
          ? <circle key={i} cx={c} cy={c} r={r} fill={s.color} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} className="pie-seg" />
          : <path key={i} d={s.d} fill={s.color} stroke="var(--white)" strokeWidth="2" onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} className="pie-seg" />
        )}
        <circle cx={c} cy={c} r={ir} fill="var(--white)" />
        <text x={c} y={c - 5} textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="800" fill="var(--text)">{total}</text>
        <text x={c} y={c + 13} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="var(--muted)" letterSpacing=".08em">TOTAL</text>
      </svg>
      {hovered !== null && (
        <div className="pie-tip" style={{ left: pos.x + 14, top: pos.y - 34 }}>
          <span className="pie-tip-dot" style={{ background: segs[hovered].color }} />
          <span className="pie-tip-label">{segs[hovered].label}</span>
          <span className="pie-tip-val">{segs[hovered].value} ({segs[hovered].pct}%)</span>
        </div>
      )}
    </div>
  )
}

/* ─── Quick Task Modal ─── */

function QuickTaskModal({ onSave, onClose }) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [priority, setPriority] = useState('medium')
  const [addReminders, setAddReminders] = useState(false)
  const [reminders, setReminders] = useState([{ date: today(), time: '' }])

  const toggleReminders = (checked) => {
    setAddReminders(checked)
    if (checked && reminders.length === 0) {
      setReminders([{ date: dueDate, time: '' }])
    }
  }

  const addReminderEntry = () => {
    setReminders(prev => [...prev, { date: dueDate, time: '' }])
  }

  const updateReminderEntry = (i, field, value) => {
    setReminders(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  const removeReminderEntry = (i) => {
    const next = reminders.filter((_, idx) => idx !== i)
    if (next.length === 0) {
      setAddReminders(false)
      setReminders([{ date: dueDate, time: '' }])
    } else {
      setReminders(next)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title, dueDate, priority, category: 'Homework', dueTime: '', notes: '', reminders: addReminders ? reminders : [] })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
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

/* ─── Quick Reminder Modal ─── */

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

/* ─── Row Components ─── */

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

/* ─── Widget System ─── */

const WIDGET_META = {
  stats:       { title: 'Overview' },
  overdue:     { title: 'Overdue', link: { to: '/tasks', text: 'View all' } },
  'due-today': { title: 'Due Today', link: { to: '/tasks', text: 'View all tasks' } },
  upcoming:    { title: 'Upcoming — Next 7 Days', link: { to: '/calendar', text: 'Open calendar' } },
  charts:      { title: 'Analytics' },
  'ai-chat':   { title: 'AI Assistant' },
}

/* ─── AI Chat Panel (popped-out widget) ─── */

const CHAT_SUGGESTIONS = [
  'What tasks are due today?',
  'Show my overdue items',
]

function AiChatPanel() {
  const { messages, typing, sendMessage, clearChat } = useAi()
  const [input, setInput] = useState('')
  const msgsRef = useRef(null)

  useEffect(() => {
    if (msgsRef.current) {
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight
    }
  }, [messages, typing])

  const handleSend = () => {
    if (!input.trim()) return
    sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className="ai-messages" ref={msgsRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`ai-msg ai-msg-${msg.role}`}>
            {msg.role === 'bot' && (
              <div className="ai-msg-avatar"><Bot size={14} /></div>
            )}
            <div className="ai-msg-bubble">{msg.text}</div>
          </div>
        ))}
        {typing && (
          <div className="ai-msg ai-msg-bot">
            <div className="ai-msg-avatar"><Bot size={14} /></div>
            <div className="ai-msg-bubble ai-typing"><span /><span /><span /></div>
          </div>
        )}
        {messages.length <= 2 && !typing && (
          <div className="ai-suggestions">
            {CHAT_SUGGESTIONS.map((s, i) => (
              <button key={i} className="ai-suggestion" onClick={() => sendMessage(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>
      <div className="ai-input-bar">
        <textarea
          className="ai-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          rows={1}
        />
        <button
          className={`ai-send${input.trim() ? ' ai-send-active' : ''}`}
          onClick={handleSend}
          disabled={!input.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </>
  )
}

const DEFAULT_LAYOUT = [
  { id: 'stats', size: 'full' },
  { id: 'overdue', size: 'half' },
  { id: 'due-today', size: 'half' },
  { id: 'upcoming', size: 'half' },
  { id: 'charts', size: 'half' },
]

function loadLayout() {
  try {
    const raw = localStorage.getItem('nw_dash_layout')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(w => w.id && WIDGET_META[w.id])) {
        return parsed
      }
    }
  } catch { /* use default */ }
  return DEFAULT_LAYOUT
}

function persistLayout(layout) {
  localStorage.setItem('nw_dash_layout', JSON.stringify(layout))
}

/* ─── Dashboard ─── */

export default function Dashboard() {
  const { user } = useAuth()
  const { poppedOut, togglePopOut, clearChat } = useAi()
  const [tasks, setTasks] = useState([])
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const [quickMode, setQuickMode] = useState(null)
  const [layout, setLayout] = useState(loadLayout)
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

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

  /* Sync ai-chat widget with pop-out state */
  useEffect(() => {
    setLayout(prev => {
      const hasChat = prev.some(w => w.id === 'ai-chat')
      if (poppedOut && !hasChat) {
        const next = [...prev, { id: 'ai-chat', size: 'half' }]
        persistLayout(next)
        return next
      }
      if (!poppedOut && hasChat) {
        const next = prev.filter(w => w.id !== 'ai-chat')
        persistLayout(next)
        return next
      }
      return prev
    })
  }, [poppedOut])

  const todayStr = today()
  const weekStr = daysFromNow(7)

  const overdue = tasks.filter(t => !t.completed && t.dueDate < todayStr)
  const dueToday = tasks.filter(t => !t.completed && t.dueDate === todayStr)
  const upcoming = tasks.filter(t => !t.completed && t.dueDate > todayStr && t.dueDate <= weekStr)
  const remToday = reminders.filter(r => r.date === todayStr)
  const remUpcoming = reminders.filter(r => r.date > todayStr && r.date <= weekStr)
  const completed = tasks.filter(t => t.completed).length

  const priorityData = [
    { label: 'High', value: tasks.filter(t => !t.completed && t.priority === 'high').length, color: '#D57272' },
    { label: 'Medium', value: tasks.filter(t => !t.completed && t.priority === 'medium').length, color: '#EDC78F' },
    { label: 'Low', value: tasks.filter(t => !t.completed && t.priority === 'low').length, color: '#8BD4A0' },
  ]

  const statusData = [
    { label: 'Overdue', value: overdue.length, color: '#DC2626' },
    { label: 'On Track', value: tasks.filter(t => !t.completed && t.dueDate >= todayStr).length, color: '#006A4E' },
    { label: 'Completed', value: completed, color: '#B8DDD0' },
  ]

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
    const { reminders: remindersList = [], ...taskData } = form
    const created = await createTask({ ...taskData, userId: user.id })
    setTasks(prev => [...prev, created])
    for (const rem of remindersList) {
      const reminder = await createReminder({
        userId: user.id,
        title: taskData.title,
        date: rem.date,
        time: rem.time,
        notes: '',
      })
      setReminders(prev => [...prev, reminder])
    }
    setQuickMode(null)
  }

  const handleQuickReminder = async (form) => {
    const created = await createReminder({ ...form, userId: user.id })
    setReminders(prev => [...prev, created])
    setQuickMode(null)
  }

  /* ── Drag-and-drop handlers ── */

  const handleDragStart = (e, idx) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (idx !== dragIdx) setOverIdx(idx)
  }

  const handleDragLeave = () => setOverIdx(null)

  const handleDrop = (e, idx) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null)
      setOverIdx(null)
      return
    }
    const next = [...layout]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setLayout(next)
    persistLayout(next)
    setDragIdx(null)
    setOverIdx(null)
  }

  const handleDragEnd = () => {
    setDragIdx(null)
    setOverIdx(null)
  }

  const resetLayout = () => {
    setLayout([...DEFAULT_LAYOUT])
    persistLayout(DEFAULT_LAYOUT)
  }

  /* ── Widget content renderer ── */

  const widgetContent = (id) => {
    switch (id) {
      case 'stats':
        return (
          <div className="dash-stats-row">
            <div className="dash-stat-mini" style={{ background: '#FFA6A6' }}>
              <div className="dash-stat-n" style={{ color: '#9C4848' }}>{overdue.length}</div>
              <div className="dash-stat-l">Overdue</div>
            </div>
            <div className="dash-stat-mini" style={{ background: '#FFEFB5' }}>
              <div className="dash-stat-n" style={{ color: '#92400E' }}>{dueToday.length + remToday.length}</div>
              <div className="dash-stat-l">Due Today</div>
            </div>
            <div className="dash-stat-mini" style={{ background: '#E2FFAF' }}>
              <div className="dash-stat-n" style={{ color: '#2D5016' }}>{upcoming.length + remUpcoming.length}</div>
              <div className="dash-stat-l">This Week</div>
            </div>
            <div className="dash-stat-mini" style={{ background: 'var(--green-lt)' }}>
              <div className="dash-stat-n" style={{ color: 'var(--green)' }}>{completed}</div>
              <div className="dash-stat-l">Completed</div>
            </div>
          </div>
        )

      case 'overdue':
        return overdue.length === 0
          ? <p className="dash-empty">No overdue items — you're on track!</p>
          : overdue.map(task => <TaskRow key={task.id} task={task} onToggle={handleToggle} />)

      case 'due-today':
        return dueToday.length === 0 && remToday.length === 0
          ? <p className="dash-empty">Nothing due today — enjoy your day!</p>
          : <>
              {dueToday.map(task => <TaskRow key={task.id} task={task} onToggle={handleToggle} />)}
              {remToday.map(rem => <ReminderRow key={rem.id} reminder={rem} />)}
            </>

      case 'upcoming':
        return timeline.length === 0
          ? <p className="dash-empty">Nothing scheduled for the next 7 days.</p>
          : timeline.map(item =>
              item._type === 'task'
                ? <TaskRow key={`t-${item.id}`} task={item} onToggle={handleToggle} showDate />
                : <ReminderRow key={`r-${item.id}`} reminder={item} showDate />
            )

      case 'charts':
        return (
          <div className="dash-charts-inner">
            <div className="dash-chart-card dash-chart-square">
              <div className="dash-chart-title">Tasks by Priority</div>
              <PieChart data={priorityData} />
            </div>
            <div className="dash-chart-card dash-chart-square">
              <div className="dash-chart-title">Task Status</div>
              <PieChart data={statusData} />
            </div>
          </div>
        )

      case 'ai-chat':
        return <AiChatPanel />

      default:
        return null
    }
  }

  /* ── Render ── */

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
          <button className="btn-ghost" onClick={resetLayout} title="Reset dashboard layout">
            <RotateCcw size={14} /> Reset
          </button>
          <button className="btn-primary" onClick={() => setQuickMode('task')}>+ Quick Task</button>
          <button className="btn-secondary" onClick={() => setQuickMode('reminder')}>+ Quick Reminder</button>
        </div>
      </div>

      <div className="page-body">
        <div className="dash-widget-grid">
          {layout.map((widget, idx) => {
            const meta = WIDGET_META[widget.id]
            return (
              <div
                key={widget.id}
                className={
                  'dash-widget'
                  + ` dash-widget-${widget.size}`
                  + (widget.id === 'ai-chat' ? ' dash-widget-chat' : '')
                  + (widget.id === 'overdue' && overdue.length > 0 ? ' dash-widget-alert' : '')
                  + (dragIdx === idx ? ' dash-widget-dragging' : '')
                  + (overIdx === idx ? ' dash-widget-dragover' : '')
                }
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                <div className="dash-widget-handle">
                  <div className="dash-widget-grip"><GripVertical size={14} /></div>
                  {widget.id === 'ai-chat' && <Bot size={14} className="dash-widget-icon" />}
                  <span className="dash-widget-title">{meta.title}</span>
                  {widget.id === 'ai-chat' && <span className="ai-badge">Beta</span>}
                  {meta.link && (
                    <Link to={meta.link.to} className="dash-widget-link">{meta.link.text}</Link>
                  )}
                  {widget.id === 'ai-chat' && (
                    <div className="dash-widget-chat-actions">
                      <button className="ai-header-btn" onClick={clearChat} title="Clear chat"><Trash2 size={12} /></button>
                      <button className="ai-header-btn" onClick={togglePopOut} title="Dock to sidebar"><PanelRightOpen size={14} /></button>
                    </div>
                  )}
                </div>
                <div className="dash-widget-body">
                  {widgetContent(widget.id)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {quickMode === 'task' && <QuickTaskModal onSave={handleQuickTask} onClose={() => setQuickMode(null)} />}
      {quickMode === 'reminder' && <QuickReminderModal onSave={handleQuickReminder} onClose={() => setQuickMode(null)} />}
    </>
  )
}
