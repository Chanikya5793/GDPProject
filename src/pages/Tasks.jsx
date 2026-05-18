import { Pencil, Trash2, List, LayoutGrid, Check } from 'lucide-react'
import '../css/Tasks.css'

// Change this to see the different layouts
const ACTIVE_VIEW = 'grid'  // list | grid

// HARDCODED DATA - replace with real API data
const TASKS = [
  {
    id: 1,
    title: 'Read Chapter 5 - Organic Chemistry',
    dueDate: 'Today',
    dueTime: '11:59 PM',
    priority: 'high',
    category: 'Reading',
    notes: 'Focus on reaction mechanisms sections 5.3 and 5.4',
    completed: false,
    overdue: false,
  },
  {
    id: 2,
    title: 'Complete Lab Report',
    dueDate: 'Tomorrow',
    dueTime: '5:00 PM',
    priority: 'high',
    category: 'Lab',
    notes: 'Include all data tables and error analysis',
    completed: false,
    overdue: false,
  },
  {
    id: 3,
    title: 'Study for CS Midterm',
    dueDate: 'Thu, May 15',
    dueTime: '',
    priority: 'medium',
    category: 'Exam',
    notes: 'Chapters 1-6, focus on sorting algorithms',
    completed: false,
    overdue: false,
  },
  {
    id: 4,
    title: 'Math Homework Chapter 7',
    dueDate: 'Fri, May 16',
    dueTime: '11:59 PM',
    priority: 'low',
    category: 'Homework',
    notes: '',
    completed: false,
    overdue: false,
  },
  {
    id: 5,
    title: 'Submit History Essay',
    dueDate: 'Mon, May 11',
    dueTime: '',
    priority: 'high',
    category: 'Homework',
    notes: '',
    completed: false,
    overdue: true,
  },
  {
    id: 6,
    title: 'Physics Problem Set',
    dueDate: 'Wed, May 7',
    dueTime: '',
    priority: 'medium',
    category: 'Homework',
    notes: '',
    completed: true,
    overdue: false,
  },
]

// TASK CARD
function TaskCard({ task }) {
  return (
    <div className={`task-card${task.completed ? ' task-done' : ''}${task.overdue ? ' task-overdue' : ''}`}>
      <div className="task-card-top">

        {/* CHECKBOX - onClick calls toggleTask(id) */}
        <div className={`task-check${task.completed ? ' checked' : ''}`}>
          {task.completed && <Check size={10} color="#FFF" strokeWidth={3} />}
        </div>

        {/* CONTENT */}
        <div className="task-card-body">
          <div className="task-card-title">{task.title}</div>
          <div className="task-card-meta">
            {task.dueDate && (
              <span className={`task-date${task.overdue ? ' overdue' : ''}`}>
                {task.overdue ? '⚠ Overdue · ' : ''}{task.dueDate}
                {task.dueTime ? ` · ${task.dueTime}` : ''}
              </span>
            )}
            {task.category && <span className="task-cat">{task.category}</span>}
            <span className={`badge badge-${task.priority}`}>{task.priority}</span>
          </div>
          {task.notes && <div className="task-notes">{task.notes}</div>}
        </div>

        {/* ACTION BUTTONS */}
        <div className="task-card-actions">
          <div className="btn-icon" title="Edit">
            <Pencil size={14} />
          </div>
          <div className="btn-icon btn-icon-danger" title="Delete">
            <Trash2 size={14} />
          </div>
        </div>

      </div>
    </div>
  )
}

// MAIN PAGE
export default function Tasks() {
  const activeCount = TASKS.filter(t => !t.completed).length
  const completedCount = TASKS.filter(t =>  t.completed).length
  const overdueCount = TASKS.filter(t =>  t.overdue).length

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Tasks</h1>
          <p>
            {activeCount} active · {completedCount} completed
            {overdueCount > 0 && (
              <span style={{ color: 'var(--red)', marginLeft: '4px' }}>
                · {overdueCount} overdue
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* onClick opens add task modal */}
          <button className="btn-primary">+ Add Task</button>

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

        {/* FILTER BAR */}
        <div className="task-filter-bar">
          <div className="task-filter-group">
            <span className="task-filter-label">Status</span>
            <button className="filter-pill active">All</button>
            <button className="filter-pill">Active</button>
            <button className="filter-pill">Completed</button>
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Priority</span>
            <button className="filter-pill active">All</button>
            <button className="filter-pill">High</button>
            <button className="filter-pill">Medium</button>
            <button className="filter-pill">Low</button>
          </div>
          <div className="task-filter-group">
            <span className="task-filter-label">Category</span>
            <select className="form-select" style={{ padding: '5px 10px', fontSize: '13px', width: 'auto' }}>
              <option>All Categories</option>
              <option>Homework</option>
              <option>Exam</option>
              <option>Lab</option>
              <option>Reading</option>
            </select>
          </div>
          <div className="task-filter-group" style={{ marginLeft: 'auto' }}>
            <span className="task-filter-label">Sort</span>
            <select className="form-select" style={{ padding: '5px 10px', fontSize: '13px', width: 'auto' }}>
              <option>Due Date</option>
              <option>Priority</option>
              <option>Title</option>
            </select>
          </div>
        </div>

        {/* TASK LIST / GRID */}
        <div className={ACTIVE_VIEW === 'grid' ? 'task-grid' : 'task-list'}>
          {TASKS.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>

      </div>
    </>
  )
}
