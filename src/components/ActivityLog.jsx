import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ScrollText, Clock, RotateCcw, Trash2, Download, Search,
  CheckSquare, Bell, FileText, Tag, ChevronRight, ChevronDown,
  CheckCircle2, X, CornerUpLeft,
} from 'lucide-react'
import { getLogs, clearLogs, deleteLogs, SESSION_ID } from '../api/logs'
import { revertLog, canRevert, describeRevert } from '../api/activity'
import ConfirmDialog from './ConfirmDialog'

/* ─── constants ─── */

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
  reverted: '#9333EA',
}

const ENTITY_OPTIONS = [['all', 'All types'], ['task', 'Tasks'], ['reminder', 'Reminders'], ['note', 'Notes'], ['tag', 'Tags']]
const ACTION_OPTIONS = [['all', 'All actions'], ['created', 'Created'], ['updated', 'Updated'], ['deleted', 'Deleted'], ['completed', 'Completed'], ['reopened', 'Reopened'], ['reverted', 'Reverted']]

const IGNORE_KEYS = new Set(['id', 'userId', 'createdAt', 'updatedAt', '_trashId', '_trashType', '_deletedAt'])
const FIELD_LABELS = {
  title: 'Title', dueDate: 'Due date', dueTime: 'Due time', date: 'Date', time: 'Time',
  priority: 'Priority', category: 'Category', notes: 'Notes', completed: 'Status',
  body: 'Body', tagIds: 'Tags', name: 'Name', color: 'Color', attachments: 'Attachments',
}

/* ─── helpers ─── */

function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(key) {
  if (key === dayKey(Date.now())) return 'Today'
  if (key === dayKey(Date.now() - 86400000)) return 'Yesterday'
  return new Date(key + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function sessionLabel(startIso, isCurrent) {
  const d = new Date(startIso)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${isCurrent ? 'This session' : 'Session'} · ${dateStr}, ${timeStr}`
}

function relativeTime(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'completed') return value ? 'Completed' : 'Active'
  if (field === 'dueDate' || field === 'date') {
    const d = new Date(value + 'T00:00:00')
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (field === 'tagIds' && Array.isArray(value)) return value.length ? `${value.length} tag${value.length > 1 ? 's' : ''}` : 'none'
  if (field === 'attachments' && Array.isArray(value)) return value.length ? `${value.length} file${value.length > 1 ? 's' : ''}` : 'none'
  if (field === 'priority') return String(value).charAt(0).toUpperCase() + String(value).slice(1)
  const s = String(value)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

/* Field-level diff between two snapshots → [{field,label,from,to}]. */
function diffEntities(before, after) {
  const rows = []
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const k of keys) {
    if (IGNORE_KEYS.has(k) || k.startsWith('_')) continue
    const fromV = before ? before[k] : undefined
    const toV = after ? after[k] : undefined
    if (JSON.stringify(fromV) === JSON.stringify(toV)) continue
    rows.push({ field: k, label: FIELD_LABELS[k] || k, from: formatFieldValue(k, fromV), to: formatFieldValue(k, toV) })
  }
  return rows
}

function groupLogs(logs, groupBy) {
  const groups = []
  let current = null
  for (const log of logs) {
    const key = groupBy === 'day' ? dayKey(log.ts) : log.sessionId
    if (!current || current.key !== key) {
      current = { key, sessionId: log.sessionId, sessionStart: log.sessionStart, ts: log.ts, entries: [log] }
      groups.push(current)
    } else {
      current.entries.push(log)
    }
  }
  return groups
}

/* ─── component ─── */

const EMPTY_FILTERS = { entity: 'all', action: 'all', session: 'all', day: 'all', search: '' }

export default function ActivityLog() {
  const [logs, setLogs] = useState([])
  const [groupBy, setGroupBy] = useState('session')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [expanded, setExpanded] = useState(() => new Set())
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)

  const reload = useCallback(async () => { setLogs(await getLogs()) }, [])
  useEffect(() => { reload() }, [reload])

  const setFilter = (k, v) => setFilters(prev => ({ ...prev, [k]: v }))

  const sessionOptions = useMemo(() => {
    const seen = new Map()
    for (const l of logs) if (!seen.has(l.sessionId)) seen.set(l.sessionId, l.sessionStart)
    return [...seen.entries()].map(([id, start]) => [id, sessionLabel(start, id === SESSION_ID)])
  }, [logs])

  const dayOptions = useMemo(() => {
    const seen = new Set(); const out = []
    for (const l of logs) { const k = dayKey(l.ts); if (!seen.has(k)) { seen.add(k); out.push([k, dayLabel(k)]) } }
    return out
  }, [logs])

  const filtered = useMemo(() => logs.filter(l => {
    if (filters.entity !== 'all' && l.entity !== filters.entity) return false
    if (filters.action !== 'all' && l.action !== filters.action) return false
    if (filters.session !== 'all' && l.sessionId !== filters.session) return false
    if (filters.day !== 'all' && dayKey(l.ts) !== filters.day) return false
    if (filters.search && !(l.title || '').toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  }), [logs, filters])

  const groups = useMemo(() => groupLogs(filtered, groupBy), [filtered, groupBy])
  const filtersActive = filters.entity !== 'all' || filters.action !== 'all' || filters.session !== 'all' || filters.day !== 'all' || filters.search !== ''
  const allVisibleSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id))

  const toggleExpand = (id) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGroup = (key) => setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAllVisible = () => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map(l => l.id)))

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  const showToast = (msg, error = false) => { setToast({ msg, error }); setTimeout(() => setToast(null), 3500) }

  const doRevert = async (entry) => {
    const res = await revertLog(entry)
    await reload()
    if (res.ok) showToast(`Rolled back “${entry.title || entry.entity}”`)
    else showToast(res.reason || 'Rollback failed', true)
  }

  const runConfirm = async () => {
    const c = confirm
    setConfirm(null)
    if (!c) return
    if (c.type === 'clearAll') { clearLogs(); await reload() }
    else if (c.type === 'deleteSelected') { deleteLogs([...selected]); exitSelectMode(); await reload() }
    else if (c.type === 'revert') { await doRevert(c.entry) }
  }

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `activity-log-${dayKey(Date.now())}.json`
    document.body.appendChild(a); a.click(); a.remove()
    // revoke in a macrotask so the download isn't cancelled before it starts
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <ScrollText size={18} />
        <h2>Activity Log</h2>
        {logs.length > 0 && <span className="settings-trash-badge">{logs.length}</span>}
        {logs.length > 0 && (
          <div className="log-header-actions">
            <button className={`btn-ghost${selectMode ? ' active' : ''}`} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
              <CheckCircle2 size={13} /> {selectMode ? 'Done' : 'Select'}
            </button>
            <button className="btn-ghost" onClick={exportLogs} title="Export the activity log as JSON">
              <Download size={13} /> Export
            </button>
            <button className="btn-ghost" onClick={() => setConfirm({ type: 'clearAll' })}>
              <Trash2 size={13} /> Clear log
            </button>
          </div>
        )}
      </div>

      <div className="settings-info-box" style={{ marginBottom: '14px' }}>
        <p>A version history of changes you make — created, updated, deleted, and completed tasks, reminders, notes, and tags. Expand an entry to see exactly what changed, or roll a change back.</p>
      </div>

      {logs.length === 0 ? (
        <div className="trash-empty">
          <ScrollText size={30} />
          <p>No activity recorded yet</p>
        </div>
      ) : (
        <>
          {/* ── filter bar ── */}
          <div className="log-toolbar">
            <div className="log-search">
              <Search size={14} />
              <input
                type="text" placeholder="Search by title…"
                value={filters.search} onChange={e => setFilter('search', e.target.value)}
              />
              {filters.search && <button type="button" className="log-search-clear" aria-label="Clear search" onClick={() => setFilter('search', '')}><X size={12} /></button>}
            </div>
            <select className="log-select" value={filters.entity} onChange={e => setFilter('entity', e.target.value)}>
              {ENTITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="log-select" value={filters.action} onChange={e => setFilter('action', e.target.value)}>
              {ACTION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="log-select" value={filters.session} onChange={e => setFilter('session', e.target.value)} disabled={groupBy === 'day'}>
              <option value="all">All sessions</option>
              {sessionOptions.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            <select className="log-select" value={filters.day} onChange={e => setFilter('day', e.target.value)}>
              <option value="all">All days</option>
              {dayOptions.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            <div className="log-groupby">
              <button className={groupBy === 'session' ? 'active' : ''} onClick={() => setGroupBy('session')}>Session</button>
              <button className={groupBy === 'day' ? 'active' : ''} onClick={() => setGroupBy('day')}>Day</button>
            </div>
            {filtersActive && <button className="btn-ghost log-clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}>Reset</button>}
          </div>

          {/* ── selection bar ── */}
          {selectMode && (
            <div className="log-selectbar">
              <label className="log-selectall">
                <input type="checkbox" checked={allVisibleSelected} onChange={selectAllVisible} />
                Select all{filtersActive ? ' (filtered)' : ''}
              </label>
              <span className="log-selectcount">{selected.size} selected</span>
              <button className="btn-danger log-delete-selected" disabled={selected.size === 0} onClick={() => setConfirm({ type: 'deleteSelected' })}>
                <Trash2 size={13} /> Delete{selected.size ? ` ${selected.size}` : ''}
              </button>
            </div>
          )}

          {/* ── grouped entries ── */}
          {filtered.length === 0 ? (
            <div className="trash-empty"><p>No entries match your filters</p></div>
          ) : (
            <div className="log-sessions">
              {groups.map(group => {
                const label = groupBy === 'day' ? dayLabel(dayKey(group.ts)) : sessionLabel(group.sessionStart, group.sessionId === SESSION_ID)
                const collapsed = collapsedGroups.has(group.key)
                return (
                  <div key={group.key} className="log-session">
                    <button type="button" className="log-session-head" onClick={() => toggleGroup(group.key)}>
                      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <Clock size={12} />
                      <span>{label}</span>
                      <span className="log-session-count">{group.entries.length}</span>
                    </button>
                    {!collapsed && (
                      <div className="log-entries">
                        {group.entries.map(entry => {
                          const meta = LOG_ENTITY_META[entry.entity] || LOG_ENTITY_META.task
                          const Icon = meta.icon
                          const diffRows = diffEntities(entry.before, entry.after)
                          const isExpanded = expanded.has(entry.id)
                          const revertable = canRevert(entry)
                          return (
                            <div key={entry.id} className={`log-entry${entry.reverted ? ' reverted' : ''}${selected.has(entry.id) ? ' selected' : ''}`}>
                              <div className="log-entry-main">
                                {selectMode && (
                                  <input type="checkbox" className="log-entry-check" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} />
                                )}
                                <span className="log-entry-icon" style={{ color: meta.color }}><Icon size={14} /></span>
                                <span className="log-entry-action" style={{ color: LOG_ACTION_COLORS[entry.action] || 'var(--muted)' }}>{entry.action}</span>
                                <span className="log-entry-entity">{meta.label.toLowerCase()}</span>
                                {entry.title && <span className="log-entry-title">"{entry.title}"</span>}
                                {entry.reverted && <span className="log-reverted-badge"><CornerUpLeft size={10} /> reverted</span>}
                                <span className="log-entry-spacer" />
                                {diffRows.length > 0 && (
                                  <button type="button" className="log-entry-expand" aria-label={isExpanded ? 'Hide details' : 'Show what changed'} onClick={() => toggleExpand(entry.id)} title={isExpanded ? 'Hide details' : 'Show what changed'}>
                                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  </button>
                                )}
                                <span className="log-entry-time" title={new Date(entry.ts).toLocaleString()}>{relativeTime(entry.ts)}</span>
                                {revertable && (
                                  <button type="button" className="log-entry-revert" aria-label="Roll back this change" onClick={() => setConfirm({ type: 'revert', entry })} title="Roll back this change">
                                    <RotateCcw size={13} />
                                  </button>
                                )}
                              </div>
                              {isExpanded && diffRows.length > 0 && (
                                <div className="log-diff">
                                  {diffRows.map(row => (
                                    <div key={row.field} className="log-diff-row">
                                      <span className="log-diff-field">{row.label}</span>
                                      <span className="log-diff-from">{row.from}</span>
                                      <span className="log-diff-arrow">→</span>
                                      <span className="log-diff-to">{row.to}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.type === 'revert' ? 'Roll back this change?' : confirm.type === 'deleteSelected' ? 'Delete selected entries?' : 'Clear the activity log?'}
          message={
            confirm.type === 'revert' ? describeRevert(confirm.entry)
              : confirm.type === 'deleteSelected' ? `Permanently remove ${selected.size} selected log ${selected.size === 1 ? 'entry' : 'entries'}. This does not change your tasks or notes.`
                : 'Permanently remove every entry from the activity log. Your tasks, reminders, and notes are not affected.'
          }
          confirmLabel={confirm.type === 'revert' ? 'Roll back' : 'Delete'}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      {toast && (
        <div className={`log-toast${toast.error ? ' error' : ''}`}>
          {toast.error ? <X size={15} /> : <CheckCircle2 size={15} />}
          <span>{toast.msg}</span>
        </div>
      )}
    </section>
  )
}
