import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { getTasks, toggleTask } from '../api/tasks'
import { getReminders } from '../api/reminders'
import { Check } from 'lucide-react'
import '../css/Calendar.css'

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function today() {
  return localDateStr()
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${m} ${ampm}`
}

function ItemPill({ item }) {
  const isTask = item._type === 'task'
  return (
    <div className={`cal-pill ${isTask ? 'cal-pill-task' : 'cal-pill-reminder'}${item.completed ? ' cal-pill-done' : ''}`} title={item.title}>
      {!isTask && '🔔 '}{item.title}
    </div>
  )
}

function MonthView({ year, month, itemsByDate, selectedDate, todayStr, onSelectDay, weekStartsOn }) {
  const startOffset = weekStartsOn === 'monday' ? 1 : 0
  const rawFirst = new Date(year, month, 1).getDay()
  const firstDay = (rawFirst - startOffset + 7) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayHeaders = startOffset === 1
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : allDays

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="cal-month">
      <div className="cal-month-header">
        {dayHeaders.map(d => (
          <div key={d} className="cal-month-dow">{d}</div>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="cal-cell cal-cell-empty" />

          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const items = itemsByDate[dateStr] || []
          const tasks = items.filter(x => x._type === 'task')
          const rems = items.filter(x => x._type === 'reminder')

          return (
            <div key={dateStr}
              className={`cal-cell${isToday ? ' cal-cell-today' : ''}${isSelected ? ' cal-cell-selected' : ''}`}
              onClick={() => onSelectDay(dateStr)}
            >
              <div className="cal-cell-num">{day}</div>
              <div className="cal-cell-items">
                {tasks.slice(0, 2).map(t => <ItemPill key={`t-${t.id}`} item={t} />)}
                {rems.slice(0, 1).map(r => <ItemPill key={`r-${r.id}`} item={r} />)}
                {items.length > 3 && <div className="cal-more">+{items.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayPanel({ date, items, onToggle, onClose }) {
  const d = new Date(date + 'T00:00:00')
  const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
  const fullDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const tasks = items.filter(i => i._type === 'task')
  const reminders = items.filter(i => i._type === 'reminder')

  return (
    <div className="cal-panel">
      <div className="cal-panel-header">
        <div>
          <div className="cal-panel-date">{dayName}</div>
          <div className="cal-panel-date-full">{fullDate}</div>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {tasks.length === 0 && reminders.length === 0 && (
        <p className="cal-panel-empty">Nothing scheduled for this day.</p>
      )}

      {tasks.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Tasks</div>
          {tasks.map(task => (
            <div key={task.id} className={`cal-panel-item${task.completed ? ' done' : ''}`}>
              <button className={`task-check${task.completed ? ' checked' : ''}`}
                style={{ width: '18px', height: '18px', flexShrink: 0 }}
                onClick={() => onToggle(task.id)}>
                {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
              </button>
              <div className="cal-panel-item-body">
                <div className="cal-panel-item-title">{task.title}</div>
                <div className="cal-panel-item-meta">
                  {task.dueTime && <span>{formatTime(task.dueTime)}</span>}
                  {task.category && <span>{task.category}</span>}
                  <span className={`badge badge-${task.priority}`}>{task.priority}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {reminders.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Reminders</div>
          {reminders.map(rem => (
            <div key={rem.id} className="cal-panel-item cal-panel-item-reminder">
              <div className="dash-bell" style={{ width: '18px', height: '18px', flexShrink: 0 }}>🔔</div>
              <div className="cal-panel-item-body">
                <div className="cal-panel-item-title">{rem.title}</div>
                <div className="cal-panel-item-meta">
                  {rem.time && <span>{formatTime(rem.time)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Calendar() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [tasks, setTasks] = useState([])
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const todayStr = today()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [panelOpen, setPanelOpen] = useState(true)

  useEffect(() => {
    Promise.all([getTasks(user.id), getReminders(user.id)]).then(([t, r]) => {
      setTasks(t)
      setReminders(r)
      setLoading(false)
    })
  }, [user.id])

  const handleToggle = async (id) => {
    const updated = await toggleTask(id)
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
  }

  const goBack = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const goForward = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  const goToday = () => {
    const n = new Date()
    setYear(n.getFullYear())
    setMonth(n.getMonth())
    setSelectedDate(todayStr)
    setPanelOpen(true)
  }

  const onSelectDay = (dateStr) => {
    setSelectedDate(dateStr)
    setPanelOpen(true)
  }

  const itemsByDate = {}
  for (const t of tasks) {
    if (!t.dueDate) continue
    if (!itemsByDate[t.dueDate]) itemsByDate[t.dueDate] = []
    itemsByDate[t.dueDate].push({ ...t, _type: 'task' })
  }
  for (const r of reminders) {
    if (!r.date) continue
    if (!itemsByDate[r.date]) itemsByDate[r.date] = []
    itemsByDate[r.date].push({ ...r, _type: 'reminder' })
  }

  const selectedItems = itemsByDate[selectedDate] || []
  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const taskCount = tasks.filter(t => !t.completed).length
  const remCount = reminders.length

  if (loading) return <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><p style={{ color: 'var(--muted)' }}>Loading calendar...</p></div>

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Calendar</h1>
          <p>{taskCount} task{taskCount !== 1 ? 's' : ''} · {remCount} reminder{remCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="cal-view-switcher">
          <button className="cal-view-btn active">Month</button>
        </div>
      </div>

      <div className="page-body">
        <div className={`cal-wrap${panelOpen ? ' cal-wrap-split' : ''}`}>
          <div className="cal-main">
            <div className="cal-nav">
              <div className="cal-nav-left">
                <button className="btn-ghost cal-nav-btn" onClick={goBack}>‹</button>
                <button className="btn-ghost cal-nav-btn" onClick={goForward}>›</button>
                <button className="btn-ghost" onClick={goToday}>Today</button>
              </div>
              <div className="cal-nav-title">{monthName}</div>
              <div className="cal-legend">
                <span className="cal-legend-item cal-legend-task">Tasks</span>
                <span className="cal-legend-item cal-legend-reminder">Reminders</span>
              </div>
            </div>
            <MonthView
              year={year}
              month={month}
              itemsByDate={itemsByDate}
              selectedDate={selectedDate}
              todayStr={todayStr}
              onSelectDay={onSelectDay}
              weekStartsOn={settings.weekStartsOn}
            />
          </div>

          {panelOpen && (
            <DayPanel
              date={selectedDate}
              items={selectedItems}
              onToggle={handleToggle}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      </div>
    </>
  )
}
