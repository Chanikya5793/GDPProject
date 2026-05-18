import { Bell, Pencil, Trash2, List, LayoutGrid } from 'lucide-react'
import '../css/Reminders.css'


// Change this to see the different layouts
const ACTIVE_VIEW = 'list'  // grid | list

// HARDCODED DATA - replace with API data

const GROUPS = [
  {
    date: 'Mon, May 11',
    isPast: true,
    isToday: false,
    reminders: [
      {
        id: 1,
        title: 'Dentist Appointment',
        time: '9:00 AM',
        notes: 'Bring insurance card',
        overdue: true,
        today: false
      },
    ],
  },
  {
    date: 'Today - Wednesday, May 13',
    isPast: false,
    isToday: true,
    reminders: [
      {
        id: 2,
        title: 'Advisor Meeting',
        time: '10:00 AM',
        notes: 'Discuss spring course schedule',
        overdue: false,
        today: true
      },
      {
        id: 3,
        title: 'Study Group - Library Rm 304',
        time: '2:00 PM',
        notes: 'Bring organic chemistry notes',
        overdue: false,
        today: true
      },
    ],
  },
  {
    date: 'Thursday, May 15',
    isPast: false,
    isToday: false,
    reminders: [
      {
        id: 4,
        title: 'Office Hours - Prof. Martinez',
        time: '9:30 AM',
        notes: 'Ask about lab report format',
        overdue: false,
        today: false
      },
    ],
  },
  {
    date: 'Friday, May 16',
    isPast: false,
    isToday: false,
    reminders: [
      {
        id: 5,
        title: 'Call Financial Aid Office',
        time: '11:00 AM',
        notes: '',
        overdue: false,
        today: false
      },
      {
        id: 6,
        title: 'Campus Health Appointment',
        time: '3:30 PM',
        notes: 'Room 120, wellness center',
        overdue: false,
        today: false
      },
    ],
  },
]

// REMINDER CARD
function ReminderCard({ reminder }) {
  return (
    <div className={`rem-card${reminder.overdue ? ' rem-overdue' : ''}${reminder.today ? ' rem-today' : ''}`}>

      {/* LEFT - bell icon + time */}
      <div className="rem-card-left">
        <div className="rem-bell-wrap">
          <Bell size={18} />
        </div>
        <div className="rem-time-block">
          <div className="rem-time">{reminder.time}</div>
        </div>
      </div>

      {/* MIDDLE - title, status, notes */}
      <div className="rem-card-body">
        <div className="rem-card-title">{reminder.title}</div>
        <div className="rem-card-meta">
          {reminder.overdue && (
            <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: '12px' }}>⚠ Overdue</span>
          )}
          {reminder.today && !reminder.overdue && (
            <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '12px' }}>📅 Today</span>
          )}
          {!reminder.overdue && !reminder.today && (
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Upcoming</span>
          )}
        </div>
        {reminder.notes && <div className="rem-notes">{reminder.notes}</div>}
      </div>

      {/* RIGHT - action buttons */}
      <div className="rem-card-actions">
        <div className="btn-icon" title="Edit">
          <Pencil size={14} />
        </div>
        <div className="btn-icon btn-icon-danger" title="Delete">
          <Trash2 size={14} />
        </div>
      </div>

    </div>
  )
}

// MAIN PAGE
export default function Reminders() {
  const totalToday = GROUPS.filter(g => g.isToday).flatMap(g => g.reminders).length
  const totalUpcoming = GROUPS.filter(g => !g.isPast && !g.isToday).flatMap(g => g.reminders).length
  const totalOverdue = GROUPS.flatMap(g => g.reminders).filter(r => r.overdue).length

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Reminders</h1>
          <p>
            {totalToday > 0 && (
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{totalToday} today · </span>
            )}
            {totalUpcoming} upcoming
            {totalOverdue > 0 && (
              <span style={{ color: 'var(--red)' }}> · {totalOverdue} overdue</span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* onClick opens add reminder modal when wired up */}
          <button className="btn-primary">+ Add Reminder</button>

          {/* VIEW TOGGLE */}
          <div className="view-toggle">
            <button className={`view-toggle-btn${ACTIVE_VIEW === 'list' ? ' active' : ''}`} title="List view">
              <List size={16} />
            </button>
            <button className={`view-toggle-btn${ACTIVE_VIEW === 'grid' ? ' active' : ''}`} title="Grid view">
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* FILTER TABS */}
        <div className="rem-filter-bar">
          <button className="filter-pill active">Upcoming</button>
          <button className="filter-pill">Past</button>
          <button className="filter-pill">All</button>
        </div>

        {/* GROUPED REMINDER LIST */}
        <div className="rem-list">
          {GROUPS.map(group => (
            <div key={group.date} className="rem-group">

              {/* DATE HEADER */}
              <div className={`rem-group-label${group.isToday ? ' rem-group-today' : ''}${group.isPast ? ' rem-group-past' : ''}`}>
                {group.isPast ? '⚠ ' : ''}{group.date}
              </div>

              {ACTIVE_VIEW === 'grid' ? (
                <div className="rem-grid">
                  {group.reminders.map(r => <ReminderCard key={r.id} reminder={r} />)}
                </div>
              ) : (
                group.reminders.map(r => <ReminderCard key={r.id} reminder={r} />)
              )}

            </div>
          ))}
        </div>

      </div>
    </>
  )
}
