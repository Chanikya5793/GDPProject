// Single source of truth for deadline-based priority escalation.
// Shared by the Tasks page and the Dashboard widgets so both views stay
// consistent. The stored priority is NEVER changed — only the visual
// (effective) priority escalates as a deadline approaches.

export function getDaysUntilDue(dueDateStr) {
  if (!dueDateStr) return Infinity
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr + 'T00:00:00')
  return Math.floor((due - t) / 86400000)
}

/**
 * Returns the effective (display) priority based on deadline proximity.
 *
 * Rules (incomplete tasks with a due date only):
 *   overdue / today / tomorrow (≤ 1 day) →  any priority  →  HIGH
 *   2–4 days                              →  low            →  MEDIUM
 */
export function getEffectivePriority(task) {
  if (task.completed || !task.dueDate) {
    const p = task.priority || 'medium'
    return { effective: p, original: p, wasEscalated: false, daysUntilDue: Infinity }
  }
  const days = getDaysUntilDue(task.dueDate)
  const original = task.priority || 'medium'
  let effective = original
  if (days <= 1) {
    effective = 'high'
  } else if (days <= 4) {
    if (original === 'low') effective = 'medium'
  }
  return { effective, original, wasEscalated: effective !== original, daysUntilDue: days }
}
