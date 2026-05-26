import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { getTasks, toggleTask, updateTask } from '../api/tasks'
import { getReminders, updateReminder } from '../api/reminders'
import { getCategories } from '../api/categories'
import { Check, ChevronDown, Calendar as CalIcon, Columns3, LayoutList, CalendarDays, Grid3X3, Pencil, X as XIcon, Save, CircleCheckBig, Bell } from 'lucide-react'
import '../css/Calendar.css'

/* ── helpers ── */

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function today() { return localDateStr() }

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function formatHour(h) {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

function getWeekDates(refDate, weekStartsOn) {
  const d = new Date(refDate + 'T00:00:00')
  const startOffset = weekStartsOn === 'monday' ? 1 : 0
  const diff = (d.getDay() - startOffset + 7) % 7
  const weekStart = new Date(d)
  weekStart.setDate(d.getDate() - diff)
  const dates = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(weekStart)
    dd.setDate(weekStart.getDate() + i)
    dates.push(localDateStr(dd))
  }
  return dates
}

function getViewDates(selectedDate, view, weekStartsOn) {
  const d = new Date(selectedDate + 'T00:00:00')
  switch (view) {
    case 'day':
      return [localDateStr(d)]
    case 'threeday':
      return [0, 1, 2].map(i => {
        const dd = new Date(d); dd.setDate(d.getDate() + i); return localDateStr(dd)
      })
    case 'workweek': {
      const day = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - ((day + 6) % 7))
      return [0, 1, 2, 3, 4].map(i => {
        const dd = new Date(monday); dd.setDate(monday.getDate() + i); return localDateStr(dd)
      })
    }
    case 'week':
      return getWeekDates(selectedDate, weekStartsOn)
    default:
      return []
  }
}

function getNavTitle(view, selectedDate, year, month, weekStartsOn) {
  if (view === 'month') {
    return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  if (view === 'day') {
    const d = new Date(selectedDate + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  const dates = getViewDates(selectedDate, view, weekStartsOn)
  const first = new Date(dates[0] + 'T00:00:00')
  const last = new Date(dates[dates.length - 1] + 'T00:00:00')
  if (first.getMonth() === last.getMonth()) {
    return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`
  }
  return `${first.toLocaleDateString('en-US', { month: 'short' })} ${first.getDate()} - ${last.toLocaleDateString('en-US', { month: 'short' })} ${last.getDate()}, ${first.getFullYear()}`
}

/* ── shared pill ── */

function itemTipData(item) {
  return JSON.stringify({
    type: item._type,
    id: item.id,
    date: item.dueDate || item.date || '',
    title: item.title,
    time: item.dueTime || item.time || '',
    priority: item.priority || '',
    category: item.category || '',
  })
}

function ItemPill({ item }) {
  const isTask = item._type === 'task'
  return (
    <div
      className={`cal-pill ${isTask ? 'cal-pill-task' : 'cal-pill-reminder'}${item.completed ? ' cal-pill-done' : ''}`}
      data-cal-item={itemTipData(item)}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData('application/json', JSON.stringify({ type: item._type, id: item.id }))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {!isTask && '🔔 '}{item.title}
    </div>
  )
}

/* ══════════════════════════════════════
   TIME GRID VIEW (Day / Three Day / Work Week / Week)
   Outlook-style hourly layout
   ══════════════════════════════════════ */

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function TimeGridView({ dates, itemsByDate, todayStr, onItemDrop }) {
  const scrollRef = useRef(null)
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  const [dragOverCell, setDragOverCell] = useState(null)

  // scroll to current time area on mount / view change
  useEffect(() => {
    const n = new Date()
    const target = Math.max(0, (n.getHours() - 1) * HOUR_HEIGHT)
    scrollRef.current?.scrollTo({ top: target, behavior: 'auto' })
  }, [dates[0], dates.length])

  // tick every minute
  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date()
      setNowMinutes(n.getHours() * 60 + n.getMinutes())
    }, 60000)
    return () => clearInterval(id)
  }, [])

  const todayInView = dates.includes(localDateStr())
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT

  return (
    <div className="cal-tg" style={{ '--tg-cols': dates.length }}>
      {/* column headers */}
      <div className="cal-tg-head">
        <div className="cal-tg-corner" />
        {dates.map(ds => {
          const d = new Date(ds + 'T00:00:00')
          const isToday = ds === todayStr
          return (
            <div key={ds} className={`cal-tg-col-head${isToday ? ' today' : ''}`}>
              <span className="cal-tg-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span className={`cal-tg-daynum${isToday ? ' today' : ''}`}>{d.getDate()}</span>
            </div>
          )
        })}
      </div>

      {/* all-day row */}
      <div className="cal-tg-allday">
        <div className="cal-tg-corner cal-tg-allday-lbl">All Day</div>
        {dates.map(ds => {
          const items = (itemsByDate[ds] || []).filter(i => !(i.dueTime || i.time))
          const isOver = dragOverCell?.date === ds && dragOverCell?.allDay
          return (
            <div key={ds} className={`cal-tg-allday-cell${isOver ? ' cal-tg-allday-dragover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCell({ date: ds, allDay: true }) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCell(null) }}
              onDrop={(e) => { e.preventDefault(); setDragOverCell(null); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d.type && d.id) onItemDrop(d.type, d.id, ds, '') } catch {} }}>
              {items.map(item => (
                <div key={`${item._type[0]}-${item.id}`} className={`cal-tg-chip ${item._type}`}
                  data-cal-item={itemTipData(item)}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ type: item._type, id: item.id })); e.dataTransfer.effectAllowed = 'move' }}>
                  {item.title}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* scrollable time grid */}
      <div className="cal-tg-scroll" ref={scrollRef}>
        <div className="cal-tg-body">
          {HOURS.map(h => (
            <div key={h} className="cal-tg-row">
              <div className="cal-tg-time">{h > 0 ? formatHour(h) : ''}</div>
              {dates.map(ds => {
                const isToday = ds === todayStr
                const isOver = dragOverCell?.date === ds && dragOverCell?.hour === h
                const hourItems = (itemsByDate[ds] || []).filter(i => {
                  const t = i.dueTime || i.time
                  return t && parseInt(t.split(':')[0]) === h
                })
                return (
                  <div key={ds} className={`cal-tg-cell${isToday ? ' today' : ''}${isOver ? ' cal-tg-cell-dragover' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCell({ date: ds, hour: h }) }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCell(null) }}
                    onDrop={(e) => { e.preventDefault(); setDragOverCell(null); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d.type && d.id) onItemDrop(d.type, d.id, ds, `${String(h).padStart(2, '0')}:00`) } catch {} }}>
                    {hourItems.map(item => (
                      <div
                        key={`${item._type[0]}-${item.id}`}
                        className={`cal-tg-event ${item._type}${item.completed ? ' done' : ''}`}
                        data-cal-item={itemTipData(item)}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ type: item._type, id: item.id })); e.dataTransfer.effectAllowed = 'move' }}
                      >
                        <span className="cal-tg-event-time">{formatTime(item.dueTime || item.time)}</span>
                        <span className="cal-tg-event-title">{item.title}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}

          {/* current-time indicator */}
          {todayInView && (
            <div className="cal-tg-now" style={{ top: `${nowTop}px` }}>
              <div className="cal-tg-now-dot" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════
   MONTH VIEW
   ══════════════════════════════════════ */

function MonthView({ year, month, itemsByDate, selectedDate, todayStr, onSelectDay, weekStartsOn, onItemDrop }) {
  const [dragOverDate, setDragOverDate] = useState(null)
  const startOffset = weekStartsOn === 'monday' ? 1 : 0
  const rawFirst = new Date(year, month, 1).getDay()
  const firstDay = (rawFirst - startOffset + 7) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dayHeaders = startOffset === 1
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const handleCellDrop = (e, dateStr) => {
    e.preventDefault()
    setDragOverDate(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type && data.id) onItemDrop(data.type, data.id, dateStr)
    } catch {}
  }

  return (
    <div className="cal-month">
      <div className="cal-month-header">
        {dayHeaders.map(d => <div key={d} className="cal-month-dow">{d}</div>)}
      </div>
      <div className="cal-month-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="cal-cell cal-cell-empty"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const isDragOver = dragOverDate === dateStr
          const items = itemsByDate[dateStr] || []
          const taskItems = items.filter(x => x._type === 'task')
          const remItems = items.filter(x => x._type === 'reminder')
          return (
            <div key={dateStr}
              className={`cal-cell${isToday ? ' cal-cell-today' : ''}${isSelected ? ' cal-cell-selected' : ''}${isDragOver ? ' cal-cell-dragover' : ''}`}
              onClick={() => onSelectDay(dateStr)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDate(dateStr) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDate(null) }}
              onDrop={(e) => handleCellDrop(e, dateStr)}
            >
              <div className="cal-cell-num">{day}</div>
              <div className="cal-cell-items">
                {taskItems.slice(0, 2).map(t => <ItemPill key={`t-${t.id}`} item={t} />)}
                {remItems.slice(0, 1).map(r => <ItemPill key={`r-${r.id}`} item={r} />)}
                {items.length > 3 && <div className="cal-more">+{items.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════
   DAY PANEL (sidebar for month view)
   ══════════════════════════════════════ */

function DayPanel({ date, items, onToggle, onClose, onItemUpdated, autoEditItem, onAutoEditHandled, categories }) {
  const d = new Date(date + 'T00:00:00')
  const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
  const fullDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const tasks = items.filter(i => i._type === 'task')
  const reminders = items.filter(i => i._type === 'reminder')

  // editing state: { type: 'task'|'reminder', id, ...fields }
  const [editing, setEditing] = useState(null)

  const startEditTask = (task) => {
    setEditing({
      type: 'task', id: task.id,
      title: task.title,
      dueTime: task.dueTime || '',
      category: task.category || '',
      priority: task.priority || 'medium',
      notes: task.notes || '',
    })
  }

  const startEditReminder = (rem) => {
    setEditing({
      type: 'reminder', id: rem.id,
      title: rem.title,
      time: rem.time || '',
      notes: rem.notes || '',
    })
  }

  const cancelEdit = () => setEditing(null)

  const saveEdit = async () => {
    if (!editing) return
    if (editing.type === 'task') {
      const updated = await updateTask(editing.id, {
        title: editing.title,
        dueTime: editing.dueTime,
        category: editing.category,
        priority: editing.priority,
        notes: editing.notes,
      })
      onItemUpdated('task', updated)
    } else {
      const updated = await updateReminder(editing.id, {
        title: editing.title,
        time: editing.time,
        notes: editing.notes,
      })
      onItemUpdated('reminder', updated)
    }
    setEditing(null)
  }

  const handleKey = (e) => {
    if (e.key === 'Escape') cancelEdit()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
  }

  // Auto-open edit mode when triggered by double-click from calendar grid
  useEffect(() => {
    if (!autoEditItem) return
    const item = items.find(i => i._type === autoEditItem.type && i.id === autoEditItem.id)
    if (item) {
      if (autoEditItem.type === 'task') startEditTask(item)
      else startEditReminder(item)
      onAutoEditHandled()
    }
  }, [autoEditItem])

  return (
    <div className="cal-panel">
      <div className="cal-panel-header">
        <div>
          <div className="cal-panel-date">{dayName}</div>
          <div className="cal-panel-date-full">{fullDate}</div>
        </div>
        <button className="modal-close" onClick={onClose}>&#10005;</button>
      </div>
      {tasks.length === 0 && reminders.length === 0 && (
        <p className="cal-panel-empty">Nothing scheduled for this day.</p>
      )}
      {tasks.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Tasks</div>
          {tasks.map(task => {
            const isEditing = editing?.type === 'task' && editing.id === task.id
            return isEditing ? (
              <div key={task.id} className="cal-panel-edit">
                <div className="cal-panel-edit-header">
                  <span className="cal-panel-edit-label">Edit Task</span>
                  <div className="cal-panel-edit-actions">
                    <button className="cal-panel-edit-btn cal-panel-save" onClick={saveEdit} title="Save"><Save size={14} /></button>
                    <button className="cal-panel-edit-btn cal-panel-cancel" onClick={cancelEdit} title="Cancel"><XIcon size={14} /></button>
                  </div>
                </div>
                <input className="cal-panel-input" value={editing.title} placeholder="Title"
                  onChange={e => setEditing(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={handleKey} autoFocus />
                <div className="cal-panel-edit-row">
                  <input className="cal-panel-input cal-panel-input-sm" type="time" value={editing.dueTime}
                    onChange={e => setEditing(p => ({ ...p, dueTime: e.target.value }))}
                    onKeyDown={handleKey} />
                  <select className="cal-panel-select cal-panel-input-sm" value={editing.category}
                    onChange={e => setEditing(p => ({ ...p, category: e.target.value }))}>
                    <option value="">Category</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <select className="cal-panel-select" value={editing.priority}
                  onChange={e => setEditing(p => ({ ...p, priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <textarea className="cal-panel-textarea" value={editing.notes} placeholder="Notes..."
                  rows={2} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))}
                  onKeyDown={handleKey} />
              </div>
            ) : (
              <div key={task.id} className={`cal-panel-item${task.completed ? ' done' : ''}`}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'task', id: task.id })); e.dataTransfer.effectAllowed = 'move' }}
                onDoubleClick={() => startEditTask(task)}>
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
                <button className="cal-panel-edit-trigger" onClick={() => startEditTask(task)} title="Edit">
                  <Pencil size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {reminders.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Reminders</div>
          {reminders.map(rem => {
            const isEditing = editing?.type === 'reminder' && editing.id === rem.id
            return isEditing ? (
              <div key={rem.id} className="cal-panel-edit">
                <div className="cal-panel-edit-header">
                  <span className="cal-panel-edit-label">Edit Reminder</span>
                  <div className="cal-panel-edit-actions">
                    <button className="cal-panel-edit-btn cal-panel-save" onClick={saveEdit} title="Save"><Save size={14} /></button>
                    <button className="cal-panel-edit-btn cal-panel-cancel" onClick={cancelEdit} title="Cancel"><XIcon size={14} /></button>
                  </div>
                </div>
                <input className="cal-panel-input" value={editing.title} placeholder="Title"
                  onChange={e => setEditing(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={handleKey} autoFocus />
                <input className="cal-panel-input" type="time" value={editing.time}
                  onChange={e => setEditing(p => ({ ...p, time: e.target.value }))}
                  onKeyDown={handleKey} />
                <textarea className="cal-panel-textarea" value={editing.notes} placeholder="Notes..."
                  rows={2} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))}
                  onKeyDown={handleKey} />
              </div>
            ) : (
              <div key={rem.id} className="cal-panel-item cal-panel-item-reminder"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'reminder', id: rem.id })); e.dataTransfer.effectAllowed = 'move' }}
                onDoubleClick={() => startEditReminder(rem)}>
                <div style={{ width: '18px', height: '18px', flexShrink: 0 }}>🔔</div>
                <div className="cal-panel-item-body">
                  <div className="cal-panel-item-title">{rem.title}</div>
                  <div className="cal-panel-item-meta">
                    {rem.time && <span>{formatTime(rem.time)}</span>}
                  </div>
                </div>
                <button className="cal-panel-edit-trigger" onClick={() => startEditReminder(rem)} title="Edit">
                  <Pencil size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════
   MAIN CALENDAR
   ══════════════════════════════════════ */

const VIEW_OPTIONS = [
  { key: 'day', label: 'Day', icon: CalIcon },
  { key: 'threeday', label: 'Three Day', icon: Columns3 },
  { key: 'workweek', label: 'Work Week', icon: LayoutList },
  { key: 'week', label: 'Week', icon: CalendarDays },
  { key: 'month', label: 'Month', icon: Grid3X3 },
]

export default function Calendar() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [tasks, setTasks] = useState([])
  const [reminders, setReminders] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const todayStr = today()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [panelOpen, setPanelOpen] = useState(true)
  const [view, setView] = useState('month')
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const [showTasks, setShowTasks] = useState(true)
  const [showReminders, setShowReminders] = useState(true)
  const dropdownRef = useRef(null)
  const hoverTimeoutRef = useRef(null)
  const calRef = useRef(null)
  const [hoverTip, setHoverTip] = useState(null)
  const [autoEditItem, setAutoEditItem] = useState(null)

  // sync year/month from selectedDate when in non-month views
  useEffect(() => {
    if (view !== 'month') {
      const d = new Date(selectedDate + 'T00:00:00')
      setYear(d.getFullYear())
      setMonth(d.getMonth())
    }
  }, [view, selectedDate])

  // close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setViewDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Hover tooltip via event delegation
  useEffect(() => {
    const el = calRef.current
    if (!el) return
    const handleOver = (e) => {
      const target = e.target.closest('[data-cal-item]')
      if (target) {
        try {
          const data = JSON.parse(target.dataset.calItem)
          const rect = target.getBoundingClientRect()
          setHoverTip({ ...data, x: rect.left + rect.width / 2, y: rect.top })
        } catch {}
      }
    }
    const handleOut = (e) => {
      const target = e.target.closest('[data-cal-item]')
      if (target && !target.contains(e.relatedTarget)) setHoverTip(null)
    }
    const handleDragStart = () => setHoverTip(null)
    const handleDblClick = (e) => {
      const target = e.target.closest('[data-cal-item]')
      if (!target) return
      try {
        const data = JSON.parse(target.dataset.calItem)
        setHoverTip(null)
        const itemDate = data.date
        if (itemDate) {
          const d = new Date(itemDate + 'T00:00:00')
          setYear(d.getFullYear())
          setMonth(d.getMonth())
          setSelectedDate(itemDate)
          setView('month')
          setPanelOpen(true)
          setAutoEditItem({ type: data.type, id: data.id })
        }
      } catch {}
    }
    el.addEventListener('mouseover', handleOver)
    el.addEventListener('mouseout', handleOut)
    el.addEventListener('dragstart', handleDragStart, true)
    el.addEventListener('dblclick', handleDblClick)
    return () => {
      el.removeEventListener('mouseover', handleOver)
      el.removeEventListener('mouseout', handleOut)
      el.removeEventListener('dragstart', handleDragStart, true)
      el.removeEventListener('dblclick', handleDblClick)
    }
  }, [loading])

  useEffect(() => {
    Promise.all([getTasks(user.id), getReminders(user.id), getCategories(user.id)]).then(([t, r, c]) => {
      setTasks(t); setReminders(r); setCategories(c); setLoading(false)
    })
  }, [user.id])

  const handleToggle = async (id) => {
    const updated = await toggleTask(id)
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
  }

  const handleItemDrop = async (itemType, itemId, newDate, newTime) => {
    if (itemType === 'task') {
      const updates = { dueDate: newDate }
      if (newTime !== undefined) updates.dueTime = newTime
      const updated = await updateTask(itemId, updates)
      setTasks(prev => prev.map(t => t.id === itemId ? updated : t))
    } else if (itemType === 'reminder') {
      const updates = { date: newDate }
      if (newTime !== undefined) updates.time = newTime
      const updated = await updateReminder(itemId, updates)
      setReminders(prev => prev.map(r => r.id === itemId ? updated : r))
    }
  }

  /* ── view-aware navigation ── */
  const goBack = () => {
    if (view === 'month') {
      if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1)
    } else {
      const d = new Date(selectedDate + 'T00:00:00')
      const step = view === 'day' ? 1 : view === 'threeday' ? 3 : 7
      d.setDate(d.getDate() - step)
      setSelectedDate(localDateStr(d))
    }
  }
  const goForward = () => {
    if (view === 'month') {
      if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1)
    } else {
      const d = new Date(selectedDate + 'T00:00:00')
      const step = view === 'day' ? 1 : view === 'threeday' ? 3 : 7
      d.setDate(d.getDate() + step)
      setSelectedDate(localDateStr(d))
    }
  }
  const goToday = () => {
    const n = new Date()
    setYear(n.getFullYear()); setMonth(n.getMonth())
    setSelectedDate(todayStr); setPanelOpen(true)
  }
  const onSelectDay = (dateStr) => { setSelectedDate(dateStr); setPanelOpen(true) }

  /* ── filtered items ── */
  const itemsByDate = {}
  if (showTasks) {
    for (const t of tasks) {
      if (!t.dueDate) continue
      if (!itemsByDate[t.dueDate]) itemsByDate[t.dueDate] = []
      itemsByDate[t.dueDate].push({ ...t, _type: 'task' })
    }
  }
  if (showReminders) {
    for (const r of reminders) {
      if (!r.date) continue
      if (!itemsByDate[r.date]) itemsByDate[r.date] = []
      itemsByDate[r.date].push({ ...r, _type: 'reminder' })
    }
  }
  const selectedItems = itemsByDate[selectedDate] || []

  /* ── derived ── */
  const navTitle = getNavTitle(view, selectedDate, year, month, settings.weekStartsOn)
  const isTimeGrid = view !== 'month'
  const viewDates = isTimeGrid ? getViewDates(selectedDate, view, settings.weekStartsOn) : []
  const taskCount = tasks.filter(t => !t.completed).length
  const remCount = reminders.length
  const currentViewLabel = VIEW_OPTIONS.find(v => v.key === view)?.label || 'Month'

  if (loading) {
    return (
      <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--muted)' }}>Loading calendar...</p>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Calendar</h1>
          <p>{taskCount} task{taskCount !== 1 ? 's' : ''} · {remCount} reminder{remCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="cal-view-dropdown" ref={dropdownRef}
          onMouseEnter={() => { clearTimeout(hoverTimeoutRef.current); setViewDropdownOpen(true) }}
          onMouseLeave={() => { hoverTimeoutRef.current = setTimeout(() => setViewDropdownOpen(false), 250) }}>
          <button className="cal-view-dropdown-btn" onClick={() => setViewDropdownOpen(v => !v)}>
            {currentViewLabel}
            <ChevronDown size={14} className={`cal-view-chevron${viewDropdownOpen ? ' open' : ''}`} />
          </button>
          {viewDropdownOpen && (
            <div className="cal-view-dropdown-menu">
              {VIEW_OPTIONS.map(opt => {
                const Icon = opt.icon
                return (
                  <button key={opt.key}
                    className={`cal-view-dropdown-item${view === opt.key ? ' active' : ''}`}
                    onClick={() => { setView(opt.key); setViewDropdownOpen(false) }}>
                    {view === opt.key ? <Check size={14} /> : <Icon size={14} />}
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="page-body" ref={calRef}>
        <div className={`cal-wrap${panelOpen && view === 'month' ? ' cal-wrap-split' : ''}`}>
          <div className="cal-main">
            {/* nav bar */}
            <div className="cal-nav">
              <div className="cal-nav-left">
                <button className="btn-ghost cal-nav-today" onClick={goToday}>Today</button>
              </div>
              <div className="cal-nav-center">
                <button className="btn-ghost cal-nav-btn" onClick={goBack} aria-label="Previous">&#8249;</button>
                <div className="cal-nav-title">{navTitle}</div>
                <button className="btn-ghost cal-nav-btn" onClick={goForward} aria-label="Next">&#8250;</button>
              </div>
              <div className="cal-legend">
                <button
                  className={`cal-legend-item cal-legend-task${!showTasks ? ' cal-legend-off' : ''}`}
                  onClick={() => setShowTasks(v => !v)}
                  title={showTasks ? 'Hide tasks' : 'Show tasks'}
                ><CircleCheckBig size={14} className="cal-legend-icon" />Tasks</button>
                <button
                  className={`cal-legend-item cal-legend-reminder${!showReminders ? ' cal-legend-off' : ''}`}
                  onClick={() => setShowReminders(v => !v)}
                  title={showReminders ? 'Hide reminders' : 'Show reminders'}
                ><Bell size={14} className="cal-legend-icon" />Reminders</button>
              </div>
            </div>

            {/* views */}
            {view === 'month' && (
              <MonthView year={year} month={month} itemsByDate={itemsByDate}
                selectedDate={selectedDate} todayStr={todayStr}
                onSelectDay={onSelectDay} weekStartsOn={settings.weekStartsOn}
                onItemDrop={handleItemDrop} />
            )}
            {isTimeGrid && (
              <TimeGridView dates={viewDates} itemsByDate={itemsByDate} todayStr={todayStr} onItemDrop={handleItemDrop} />
            )}
          </div>

          {panelOpen && view === 'month' && (
            <DayPanel date={selectedDate} items={selectedItems}
              onToggle={handleToggle} onClose={() => setPanelOpen(false)}
              onItemUpdated={(type, updated) => {
                if (type === 'task') setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
                else setReminders(prev => prev.map(r => r.id === updated.id ? updated : r))
              }}
              autoEditItem={autoEditItem}
              onAutoEditHandled={() => setAutoEditItem(null)}
              categories={categories} />
          )}
        </div>
      </div>

      {hoverTip && (
        <div className="cal-hover-tip" style={{ position: 'fixed', left: `${hoverTip.x}px`, top: `${hoverTip.y - 8}px`, transform: 'translate(-50%, -100%)', zIndex: 1000 }}>
          <div className="cal-hover-tip-header">
            {hoverTip.type === 'task'
              ? <CircleCheckBig size={13} className="cal-hover-tip-icon task" />
              : <Bell size={13} className="cal-hover-tip-icon reminder" />}
            <span className="cal-hover-tip-type">{hoverTip.type === 'task' ? 'Task' : 'Reminder'}</span>
            {hoverTip.priority && <span className={`badge badge-${hoverTip.priority}`} style={{ fontSize: '9px', padding: '1px 5px' }}>{hoverTip.priority}</span>}
          </div>
          <div className="cal-hover-tip-title">{hoverTip.title}</div>
          {(hoverTip.time || hoverTip.category) && (
            <div className="cal-hover-tip-meta">
              {hoverTip.time && <span>{formatTime(hoverTip.time)}</span>}
              {hoverTip.category && <span>{hoverTip.category}</span>}
            </div>
          )}
          <div className="cal-hover-tip-hint">Drag to reschedule · Double-click to edit</div>
        </div>
      )}
    </>
  )
}
