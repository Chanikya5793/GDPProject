import { Check } from 'lucide-react'
import '../css/Calendar.css'

// HARDCODED DATA - replace with API data

const ITEMS_BY_DATE = {
  '2026-05-13': [
    { 
      id: 1,
      _type: 'task',
      title: 'Read Chapter 5',
      priority: 'high',
      dueTime: '11:59 PM',
      category: 'Reading',
      completed: false
    },
    {
      id: 2,
      _type: 'reminder',
      title: 'Advisor Meeting',
      time: '10:00 AM'
    },
    {
      id: 3,
      _type: 'reminder',
      title: 'Study Group',
      time: '2:00 PM'
    },
  ],
  '2026-05-14':
  [
    {
      id: 4,
      _type: 'task',
      title: 'Complete Lab Report',
      priority: 'high',
      dueTime: '5:00 PM',
      category: 'Lab',
      completed: false
    },
  ],
  '2026-05-15': [
    {
      id: 5,
      _type: 'task',
      title: 'CS Problem Set 3',
      priority: 'medium',
      dueTime: '',
      category: 'Homework',
      completed: false
    },
    { id: 6,
      _type: 'reminder',
      title: 'Office Hours',
      time: '9:30 AM'
    },
  ],
  '2026-05-18': [
    {
      id: 7,
      _type: 'task',
      title: 'Study for CS Midterm',
      priority: 'medium',
      dueTime: '',
      category: 'Exam',
      completed: false
    },
  ],
  '2026-05-21': [
    {
      id: 8,
      _type: 'task',
      title: 'Research Paper Draft',
      priority: 'high',
      dueTime: '11:59 PM',
      category: 'Homework',
      completed: false
    },
    {
      id: 9,
      _type: 'task',
      title: 'Math Homework Ch. 7',
      priority: 'low',
      dueTime: '',
      category: 'Homework',
      completed: true
    },
  ],
  '2026-05-07': [
    {
      id: 10,
      _type: 'task',
      title: 'Physics Problem Set',
      priority: 'medium',
      dueTime: '',
      category: 'Homework',
      completed: true
    },
  ],
}

// May starts on Friday (day index 5)
const MAY_2026 = { name: 'May 2026', startDayIndex: 5, daysInMonth: 31, todayDate: 13 }

// Hardcoded selected day
const SELECTED_DATE = '2026-05-13'
const SELECTED_LABEL = 'Wednesday, May 13, 2026'
const SELECTED_ITEMS = ITEMS_BY_DATE[SELECTED_DATE] || []

// ITEM PILL - colored chip shown on each day cell

function ItemPill({ item }) {
  const isTask = item._type === 'task'
  return (
    // cal-pill-task = green & cal-pill-reminder = blue
    // cal-pill-done = strikethrough for completed items
    <div className={`cal-pill ${isTask ? 'cal-pill-task' : 'cal-pill-reminder'}${item.completed ? ' cal-pill-done' : ''}`}
      title={item.title}>
      {!isTask && '🔔 '}{item.title}
    </div>
  )
}

// MONTH VIEW
function MonthView() {
  // Build the grid:
  // 1. Fill empty cells for days before the 1st of the month
  // 2. Then fill in each day of the month
  const cells = []
  for (let i = 0; i < MAY_2026.startDayIndex; i++) cells.push(null)
  for (let d = 1; d <= MAY_2026.daysInMonth; d++) cells.push(d)

  return (
    <div className="cal-month">

      {/* Day of week headers */}
      <div className="cal-month-header">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="cal-month-dow">{d}</div>
        ))}
      </div>

      {/* Day cells - 7 per row */}
      <div className="cal-month-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="cal-cell cal-cell-empty" />

          const dateStr = `2026-05-${String(day).padStart(2,'0')}`
          const isToday = day === MAY_2026.todayDate
          const isSelected = dateStr === SELECTED_DATE
          const items = ITEMS_BY_DATE[dateStr] || []
          const tasks = items.filter(x => x._type === 'task')
          const rems = items.filter(x => x._type === 'reminder')

          return (
            // onClick calls onSelectDay(date)
            <div key={dateStr}
              className={`cal-cell${isToday ? ' cal-cell-today' : ''}${isSelected ? ' cal-cell-selected' : ''}`}
            >
              {/* Day number */}
              <div className="cal-cell-num">{day}</div>

              {/* Show up to 2 tasks + 1 reminder, then "+ more" */}
              <div className="cal-cell-items">
                {tasks.slice(0,2).map(t => <ItemPill key={t.id} item={t} />)}
                {rems.slice(0,1).map(r  => <ItemPill key={r.id} item={r} />)}
                {items.length > 3 && (
                  <div className="cal-more">+{items.length - 3} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// DAY PANEL - right sidebar shown when a day is selected
function DayPanel() {
  const tasks = SELECTED_ITEMS.filter(i => i._type === 'task')
  const reminders = SELECTED_ITEMS.filter(i => i._type === 'reminder')

  return (
    <div className="cal-panel">

      <div className="cal-panel-header">
        <div>
          <div className="cal-panel-date">Wednesday</div>
          <div className="cal-panel-date-full">{SELECTED_LABEL}</div>
        </div>
        {/* onClick closes panel */}
        <button className="modal-close">✕</button>
      </div>

      {/* TASKS SECTION */}
      {tasks.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Tasks</div>
          {tasks.map(task => (
            <div key={task.id} className={`cal-panel-item${task.completed ? ' done' : ''}`}>
              {/* Checkbox - onClick calls toggleTask(id) */}
              <div className={`task-check${task.completed ? ' checked' : ''}`}
                style={{ width: '18px', height: '18px', flexShrink: 0 }}>
                {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
              </div>
              <div className="cal-panel-item-body">
                <div className="cal-panel-item-title">{task.title}</div>
                <div className="cal-panel-item-meta">
                  {task.dueTime && <span>{task.dueTime}</span>}
                  {task.category && <span>{task.category}</span>}
                  <span className={`badge badge-${task.priority}`}>{task.priority}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* REMINDERS SECTION */}
      {reminders.length > 0 && (
        <div className="cal-panel-section">
          <div className="cal-panel-section-label">Reminders</div>
          {reminders.map(rem => (
            <div key={rem.id} className="cal-panel-item cal-panel-item-reminder">
              <div className="dash-bell" style={{ width: '18px', height: '18px', flexShrink: 0 }}>🔔</div>
              <div className="cal-panel-item-body">
                <div className="cal-panel-item-title">{rem.title}</div>
                <div className="cal-panel-item-meta">
                  {rem.time && <span>{rem.time}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

// MAIN PAGE
export default function Calendar() {
  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Calendar</h1>
          <p>5 tasks · 3 reminders</p>
        </div>

        {/* VIEW SWITCHER - onClick sets view state */}
        {/* active class highlights the current view */}
        <div className="cal-view-switcher">
          <button className="cal-view-btn active">Month</button>
          <button className="cal-view-btn">Week</button>
          <button className="cal-view-btn">Day</button>
        </div>
      </div>

      <div className="page-body">

        {/* cal-wrap-split splits the layout when a day panel is open */}
        {/* Remove cal-wrap-split and the panel disappears */}
        <div className="cal-wrap cal-wrap-split">

          {/* MAIN CALENDAR AREA */}
          <div className="cal-main">

            {/* NAVIGATION BAR */}
            <div className="cal-nav">
              <div className="cal-nav-left">
                {/* onClick calls goBack() / goForward() / goToday() */}
                <button className="btn-ghost cal-nav-btn">‹</button>
                <button className="btn-ghost cal-nav-btn">›</button>
                <button className="btn-ghost">Today</button>
              </div>
              <div className="cal-nav-title">May 2026</div>
              {/* Color legend so users know green = task, blue = reminder */}
              {/* Not sure if we want to keep the color legend in */}
              <div className="cal-legend">
                <span className="cal-legend-item cal-legend-task">Tasks</span>
                <span className="cal-legend-item cal-legend-reminder">Reminders</span>
              </div>
            </div>

            {/* MONTH GRID */}
            <MonthView />

          </div>

          {/* DAY PANEL - shown on the right when a day is selected */}
          <DayPanel />

        </div>
      </div>
    </>
  )
}
