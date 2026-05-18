import '../css/Dashboard.css'

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

// A task row with a checkbox, title, category, and priority badge
function TaskRow({ task, showDate = false }) {
  return (
    <div className="dash-row">
      {/* Checkbox - onClick will call toggleTask(task.id) */}
      <div className="dash-check" />

      <div className="dash-row-body">
        <div className="dash-row-title">{task.title}</div>
        <div className="dash-row-meta">
          {showDate && <span>{task.date}</span>}
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
      <div className="dash-bell">🔔</div>
      <div className="dash-row-body">
        <div className="dash-row-title">{reminder.title}</div>
        <div className="dash-row-meta">
          {showDate && <span>{reminder.date}</span>}
          {reminder.time && <span>{reminder.time}</span>}
        </div>
      </div>
    </div>
  )
}

// MAIN PAGE
export default function Dashboard() {
  return (
    <>
      {/* PAGE HEADER - greeting + quick add buttons */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Good morning, Bobby</h1>
          <p>Wednesday, May 13, 2026</p>
        </div>
        <div className="dash-quick-btns">
          {/* These buttons will open a quick-add form */}
          <button className="btn-primary">+ Quick Task</button>
          <button className="btn-secondary">+ Quick Reminder</button>
        </div>
      </div>

      <div className="page-body">

        {/* STAT CARDS */}
        {/* Four numbers - overdue, today, week, completed */}
        <div className="dash-stats">
          {STATS.map(stat => (
            <div key={stat.label} className={`dash-stat${stat.danger ? ' dash-stat-danger' : ''}`}>
              <div className="dash-stat-n" style={{
                color: stat.danger ? 'var(--red)' : stat.success ? 'var(--green)' : 'var(--text)'
              }}>
                {stat.value}
              </div>
              <div className="dash-stat-l">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* TWO COLUMN GRID */}
        <div className="dash-grid">

          {/* LEFT COLUMN - overdue + today */}
          <div className="dash-col">

            {/* OVERDUE SECTION - only shows if there are overdue tasks */}
            <div className="card dash-section" style={{ borderLeft: '4px solid var(--red)' }}>
              <div className="dash-section-header">
                <span className="dash-section-title" style={{ color: 'var(--red)' }}>
                  ⚠ Overdue
                </span>
                {/* This becomes a Link to="/tasks" */}
                <span className="dash-section-link">View all</span>
              </div>
              {OVERDUE_TASKS.map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>

            {/* DUE TODAY SECTION */}
            <div className="card dash-section">
              <div className="dash-section-header">
                <span className="dash-section-title">Due Today</span>
                <span className="dash-section-link">View all tasks</span>
              </div>
              {TODAY_TASKS.map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
              {TODAY_REMINDERS.map(rem => (
                <ReminderRow key={rem.id} reminder={rem} />
              ))}
            </div>

          </div>

          {/* RIGHT COLUMN - upcoming 7 days */}
          <div className="dash-col">
            <div className="card dash-section">
              <div className="dash-section-header">
                <span className="dash-section-title">Upcoming - Next 7 Days</span>
                <span className="dash-section-link">Open calendar</span>
              </div>
              {UPCOMING.map(item => (
                item._type === 'task'
                  ? <TaskRow     key={`t-${item.id}`} task={item}     showDate />
                  : <ReminderRow key={`r-${item.id}`} reminder={item} showDate />
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
