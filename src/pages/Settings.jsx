import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { getTrash, restoreFromTrash, permanentDelete, emptyTrash } from '../api/trash'
import { restoreTaskDirect } from '../api/tasks'
import { restoreReminderDirect } from '../api/reminders'
import { restoreNoteDirect } from '../api/notes'
import { getLogs, clearLogs, SESSION_ID } from '../api/logs'
import {
  User, Palette, CalendarDays, Database, Recycle,
  Sun, Moon, Monitor, RotateCcw, Download,
  Trash2, AlertTriangle, CheckSquare, Bell, FileText,
  ScrollText, Clock, Tag,
} from 'lucide-react'
import '../css/Settings.css'

const ACCENT_COLORS = [
  { id: 'green',  label: 'Green',  color: '#006A4E' },
  { id: 'blue',   label: 'Blue',   color: '#3B82F6' },
  { id: 'purple', label: 'Purple', color: '#7C3AED' },
  { id: 'amber',  label: 'Amber',  color: '#D97706' },
]

const CATEGORIES = ['Homework', 'Exam', 'Project', 'Reading', 'Lab', 'Other']

const LOG_ENTITY_META = {
  task: { icon: CheckSquare, label: 'Task', color: '#D97706' },
  reminder: { icon: Bell, label: 'Reminder', color: '#3B82F6' },
  note: { icon: FileText, label: 'Note', color: '#7C3AED' },
  tag: { icon: Tag, label: 'Tag', color: '#0AA56F' },
}

const LOG_ACTION_COLORS = {
  created: '#0AA56F',
  updated: '#3B82F6',
  deleted: '#DC2626',
  completed: '#006A4E',
  reopened: '#D97706',
}

function groupLogsBySession(logs) {
  const groups = []
  let current = null
  for (const log of logs) {
    if (!current || current.sessionId !== log.sessionId) {
      current = { sessionId: log.sessionId, sessionStart: log.sessionStart, entries: [log] }
      groups.push(current)
    } else {
      current.entries.push(log)
    }
  }
  return groups
}

function formatSessionLabel(startIso, isCurrent) {
  const d = new Date(startIso)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${isCurrent ? 'This session' : 'Session'} · ${dateStr}, ${timeStr}`
}

/* ─── Toggle Switch ─── */

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={`settings-toggle-track${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <div className="settings-toggle-thumb" />
    </button>
  )
}

/* ─── Settings Page ─── */

export default function Settings() {
  const { user, updateUser } = useAuth()
  const { settings, updateSetting, resetSettings } = useSettings()

  /* Profile editing */
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [profileSaved, setProfileSaved] = useState(false)
  const [confirmClear, setConfirmClear] = useState(null)

  /* Recycle bin */
  const [trash, setTrash] = useState([])
  const [trashFilter, setTrashFilter] = useState('all')
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)

  /* Activity log */
  const [logs, setLogs] = useState([])
  const [confirmClearLogs, setConfirmClearLogs] = useState(false)

  useEffect(() => {
    getTrash(user.id).then(setTrash)
    getLogs().then(setLogs)
  }, [user.id])

  const handleClearLogs = () => {
    if (!confirmClearLogs) {
      setConfirmClearLogs(true)
      setTimeout(() => setConfirmClearLogs(false), 3000)
      return
    }
    clearLogs()
    setLogs([])
    setConfirmClearLogs(false)
  }

  const handleRestore = async (trashId) => {
    const result = await restoreFromTrash(trashId)
    if (result) {
      const { item, type } = result
      if (type === 'task') restoreTaskDirect(item)
      else if (type === 'reminder') restoreReminderDirect(item)
      else if (type === 'note') restoreNoteDirect(item)
      setTrash(prev => prev.filter(t => t._trashId !== trashId))
    }
  }

  const handlePermanentDelete = async (trashId) => {
    await permanentDelete(trashId)
    setTrash(prev => prev.filter(t => t._trashId !== trashId))
  }

  const handleEmptyTrash = async () => {
    if (!confirmEmptyTrash) {
      setConfirmEmptyTrash(true)
      setTimeout(() => setConfirmEmptyTrash(false), 3000)
      return
    }
    await emptyTrash(user.id)
    setTrash([])
    setConfirmEmptyTrash(false)
  }

  const TRASH_TYPE_META = {
    task: { icon: CheckSquare, label: 'Task', color: '#D97706' },
    reminder: { icon: Bell, label: 'Reminder', color: '#3B82F6' },
    note: { icon: FileText, label: 'Note', color: '#7C3AED' },
  }

  const filteredTrash = trashFilter === 'all'
    ? trash
    : trash.filter(t => t._trashType === trashFilter)

  const profileChanged = name !== user?.name || email !== user?.email

  const saveProfile = () => {
    if (!name.trim()) return
    updateUser({ name: name.trim(), email: email.trim() })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  /* Data export */
  const exportData = () => {
    const data = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key.startsWith('nw_')) {
        try { data[key] = JSON.parse(localStorage.getItem(key)) }
        catch { data[key] = localStorage.getItem(key) }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `northwest-planner-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* Data clearing */
  const clearData = (type) => {
    if (confirmClear !== type) {
      setConfirmClear(type)
      setTimeout(() => setConfirmClear(null), 3000)
      return
    }
    switch (type) {
      case 'tasks':
        localStorage.removeItem('nw_tasks')
        break
      case 'reminders':
        localStorage.removeItem('nw_reminders')
        break
      case 'notes':
        localStorage.removeItem('nw_notes')
        break
      case 'all': {
        const keys = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key.startsWith('nw_') && key !== 'nw_user') keys.push(key)
        }
        keys.forEach(k => localStorage.removeItem(k))
        resetSettings()
        break
      }
    }
    setConfirmClear(null)
    window.location.reload()
  }

  const initials = (user?.name || 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Settings</h1>
          <p>Manage your account and preferences</p>
        </div>
      </div>

      <div className="page-body">
        <div className="settings-grid">

          {/* ═══ Profile ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <User size={18} />
              <h2>Profile</h2>
            </div>
            <div className="settings-profile">
              <div className="settings-avatar">{initials}</div>
              <div className="settings-profile-form">
                <div className="form-group">
                  <label className="form-label">Display Name</label>
                  <input
                    className="form-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                  />
                </div>
                <div className="settings-profile-actions">
                  {profileSaved && <span className="settings-saved">Saved!</span>}
                  <button
                    className="btn-primary"
                    onClick={saveProfile}
                    disabled={!profileChanged || !name.trim()}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ═══ Appearance ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <Palette size={18} />
              <h2>Appearance</h2>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Theme</span>
                <span className="settings-row-desc">Choose your preferred color scheme</span>
              </div>
              <div className="settings-theme-picker">
                {[
                  { id: 'light', icon: Sun, label: 'Light' },
                  { id: 'dark', icon: Moon, label: 'Dark' },
                  { id: 'system', icon: Monitor, label: 'System' },
                ].map(t => (
                  <button
                    key={t.id}
                    className={`settings-theme-btn${settings.theme === t.id ? ' active' : ''}`}
                    onClick={() => updateSetting('theme', t.id)}
                  >
                    <t.icon size={14} /> {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Accent Color</span>
                <span className="settings-row-desc">Customize the app's primary color</span>
              </div>
              <div className="settings-accent-picker">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c.id}
                    className={`settings-accent-dot${settings.accentColor === c.id ? ' active' : ''}`}
                    style={{ background: c.color }}
                    onClick={() => updateSetting('accentColor', c.id)}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Font Size</span>
                <span className="settings-row-desc">Adjust text size across the app</span>
              </div>
              <select
                className="form-select settings-select"
                value={settings.fontSize}
                onChange={e => updateSetting('fontSize', e.target.value)}
              >
                <option value="default">Default</option>
                <option value="large">Large</option>
                <option value="larger">Larger</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Compact Mode</span>
                <span className="settings-row-desc">Reduce spacing for more content density</span>
              </div>
              <Toggle checked={settings.compactMode} onChange={v => updateSetting('compactMode', v)} />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Reduced Motion</span>
                <span className="settings-row-desc">Minimize animations throughout the app</span>
              </div>
              <Toggle checked={settings.reducedMotion} onChange={v => updateSetting('reducedMotion', v)} />
            </div>
          </section>

          {/* ═══ Planner Preferences ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <CalendarDays size={18} />
              <h2>Planner Preferences</h2>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Week Starts On</span>
                <span className="settings-row-desc">First day of the week in calendar views</span>
              </div>
              <select className="form-select settings-select" value={settings.weekStartsOn} onChange={e => updateSetting('weekStartsOn', e.target.value)}>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Default Priority</span>
                <span className="settings-row-desc">Priority assigned to new tasks</span>
              </div>
              <select className="form-select settings-select" value={settings.defaultPriority} onChange={e => updateSetting('defaultPriority', e.target.value)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Default Category</span>
                <span className="settings-row-desc">Category assigned to new tasks</span>
              </div>
              <select className="form-select settings-select" value={settings.defaultCategory} onChange={e => updateSetting('defaultCategory', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Default Reminder</span>
                <span className="settings-row-desc">Default time before due date</span>
              </div>
              <select className="form-select settings-select" value={settings.reminderDefault} onChange={e => updateSetting('reminderDefault', Number(e.target.value))}>
                <option value={15}>15 minutes before</option>
                <option value={30}>30 minutes before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Show Completed Tasks</span>
                <span className="settings-row-desc">Display completed tasks in task lists</span>
              </div>
              <Toggle checked={settings.showCompleted} onChange={v => updateSetting('showCompleted', v)} />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Due Date Alerts</span>
                <span className="settings-row-desc">Flash borders on tasks due today, tomorrow, or overdue — and auto-escalate tasks due within 4 days to urgent styling</span>
              </div>
              <Toggle checked={settings.dueDateAlerts !== false} onChange={v => updateSetting('dueDateAlerts', v)} />
            </div>
          </section>

          {/* ═══ Recycle Bin ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <Recycle size={18} />
              <h2>Recycle Bin</h2>
              {trash.length > 0 && (
                <span className="settings-trash-badge">{trash.length}</span>
              )}
            </div>

            <div className="settings-info-box" style={{ marginBottom: '16px' }}>
              <p>Deleted tasks, notes, and reminders are kept here. You can restore them or permanently delete them.</p>
            </div>

            {trash.length > 0 && (
              <div className="trash-toolbar">
                <div className="trash-filters">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'task', label: 'Tasks' },
                    { value: 'note', label: 'Notes' },
                    { value: 'reminder', label: 'Reminders' },
                  ].map(f => (
                    <button
                      key={f.value}
                      className={`filter-pill${trashFilter === f.value ? ' active' : ''}`}
                      onClick={() => setTrashFilter(f.value)}
                    >
                      {f.label}
                      {f.value !== 'all' && (
                        <span className="trash-filter-count">
                          {trash.filter(t => t._trashType === f.value).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  className={`btn-danger${confirmEmptyTrash ? ' confirming' : ''}`}
                  onClick={handleEmptyTrash}
                >
                  <AlertTriangle size={12} />
                  {confirmEmptyTrash ? 'Confirm? Cannot undo!' : 'Empty All'}
                </button>
              </div>
            )}

            {filteredTrash.length === 0 ? (
              <div className="trash-empty">
                <Recycle size={30} />
                <p>{trash.length === 0 ? 'Recycle bin is empty' : 'No items match this filter'}</p>
              </div>
            ) : (
              <div className="trash-list">
                {filteredTrash.map(item => {
                  const meta = TRASH_TYPE_META[item._trashType] || TRASH_TYPE_META.task
                  const Icon = meta.icon
                  return (
                    <div key={item._trashId} className="trash-item">
                      <div className="trash-item-type" style={{ color: meta.color }}>
                        <Icon size={16} />
                      </div>
                      <div className="trash-item-info">
                        <span className="trash-item-title">{item.title || 'Untitled'}</span>
                        <span className="trash-item-meta">
                          <span className="trash-type-badge" style={{ background: meta.color + '18', color: meta.color }}>
                            {meta.label}
                          </span>
                          <span>Deleted {new Date(item._deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </span>
                      </div>
                      <div className="trash-item-actions">
                        <button className="btn-ghost" onClick={() => handleRestore(item._trashId)} title="Restore">
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button className="btn-icon btn-icon-danger" onClick={() => handlePermanentDelete(item._trashId)} title="Delete permanently">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ═══ Activity Log ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <ScrollText size={18} />
              <h2>Activity Log</h2>
              {logs.length > 0 && (
                <span className="settings-trash-badge">{logs.length}</span>
              )}
              {logs.length > 0 && (
                <button
                  className={`btn-ghost${confirmClearLogs ? ' confirming' : ''}`}
                  style={{ marginLeft: 'auto' }}
                  onClick={handleClearLogs}
                >
                  <Trash2 size={13} /> {confirmClearLogs ? 'Confirm clear?' : 'Clear log'}
                </button>
              )}
            </div>

            <div className="settings-info-box" style={{ marginBottom: '16px' }}>
              <p>A record of changes you make — created, updated, and deleted tasks, reminders, notes, and tags — grouped by session.</p>
            </div>

            {logs.length === 0 ? (
              <div className="trash-empty">
                <ScrollText size={30} />
                <p>No activity recorded yet</p>
              </div>
            ) : (
              <div className="log-sessions">
                {groupLogsBySession(logs).map(group => (
                  <div key={group.sessionId} className="log-session">
                    <div className="log-session-head">
                      <Clock size={12} />
                      <span>{formatSessionLabel(group.sessionStart, group.sessionId === SESSION_ID)}</span>
                      <span className="log-session-count">{group.entries.length}</span>
                    </div>
                    <div className="log-entries">
                      {group.entries.map(entry => {
                        const meta = LOG_ENTITY_META[entry.entity] || LOG_ENTITY_META.task
                        const Icon = meta.icon
                        return (
                          <div key={entry.id} className="log-entry">
                            <span className="log-entry-icon" style={{ color: meta.color }}>
                              <Icon size={14} />
                            </span>
                            <span className="log-entry-action" style={{ color: LOG_ACTION_COLORS[entry.action] || 'var(--muted)' }}>
                              {entry.action}
                            </span>
                            <span className="log-entry-entity">{meta.label.toLowerCase()}</span>
                            {entry.title && <span className="log-entry-title">"{entry.title}"</span>}
                            <span className="log-entry-time">
                              {new Date(entry.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ═══ Data & Privacy ═══ */}
          <section className="settings-section">
            <div className="settings-section-header">
              <Database size={18} />
              <h2>Data &amp; Privacy</h2>
            </div>

            <div className="settings-info-box">
              <p>All your data is stored locally in your browser. Nothing is sent to any server.</p>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Export Data</span>
                <span className="settings-row-desc">Download all your data as a JSON file</span>
              </div>
              <button className="btn-ghost" onClick={exportData}>
                <Download size={14} /> Export
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Reset Settings</span>
                <span className="settings-row-desc">Restore all settings to default values</span>
              </div>
              <button className="btn-ghost" onClick={resetSettings}>
                <RotateCcw size={14} /> Reset
              </button>
            </div>

            <div className="settings-danger-zone">
              <h3><AlertTriangle size={14} /> Danger Zone</h3>
              <div className="settings-danger-actions">
                {[
                  { key: 'tasks', label: 'Clear Tasks' },
                  { key: 'reminders', label: 'Clear Reminders' },
                  { key: 'notes', label: 'Clear Notes' },
                  { key: 'all', label: 'Clear All Data' },
                ].map(item => (
                  <button
                    key={item.key}
                    className={`btn-danger${confirmClear === item.key ? ' confirming' : ''}`}
                    onClick={() => clearData(item.key)}
                  >
                    <Trash2 size={12} />
                    {confirmClear === item.key
                      ? (item.key === 'all' ? 'Confirm? Cannot be undone!' : 'Confirm?')
                      : item.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

        </div>
      </div>
    </>
  )
}
