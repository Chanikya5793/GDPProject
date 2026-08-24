// Workload balancing for the Tasks page.
//
// Pure functions, kept out of the page component so they can be unit tested and
// so the Settings-driven limit has a single source of truth. Every function
// takes the "today" boundary as an argument rather than reading the clock, which
// keeps the tests deterministic.

export const DEFAULT_DAILY_TASK_LIMIT = 2

const PRIO_ORDER = { high: 0, medium: 1, low: 2 }

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr() {
  return localDateStr()
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

/**
 * Future days holding more incomplete tasks than `limit`.
 *
 * Today and overdue days are excluded: rescheduling only ever pulls work
 * earlier, and there is no earlier slot than today.
 */
export function detectOverloadedDays(tasks, limit = DEFAULT_DAILY_TASK_LIMIT, from = todayStr()) {
  const active = tasks.filter(task => !task.completed && task.dueDate && task.dueDate > from)
  const byDate = {}
  for (const task of active) {
    byDate[task.dueDate] = byDate[task.dueDate] || []
    byDate[task.dueDate].push(task)
  }
  return Object.entries(byDate)
    .filter(([, dayTasks]) => dayTasks.length > limit)
    .map(([date, dayTasks]) => ({ date, tasks: dayTasks }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Proposes pulling the lowest-priority overflow off each crowded day onto the
 * nearest earlier day that still has room. Never pushes a task later, and never
 * targets today or the past.
 *
 * `skipIds` holds tasks that auto-balance has already moved once. Honouring it
 * is what stops the automatic pass from shuffling the same task back and forth
 * on every render.
 */
export function suggestReschedule(
  overloadedDays,
  allTasks,
  limit = DEFAULT_DAILY_TASK_LIMIT,
  from = todayStr(),
  skipIds = new Set(),
) {
  // Live count per day so each proposal reserves its target slot and later
  // proposals see the day as fuller.
  const countByDate = {}
  for (const task of allTasks.filter(t => !t.completed && t.dueDate)) {
    countByDate[task.dueDate] = (countByDate[task.dueDate] || 0) + 1
  }

  const suggestions = []
  for (const day of overloadedDays) {
    const ranked = [...day.tasks].sort((a, b) =>
      PRIO_ORDER[a.priority] !== PRIO_ORDER[b.priority]
        ? (PRIO_ORDER[a.priority] ?? 3) - (PRIO_ORDER[b.priority] ?? 3)
        : new Date(a.createdAt) - new Date(b.createdAt)
    )

    for (const task of ranked.slice(limit)) {
      if (skipIds.has(task.id)) continue
      let target = null
      for (let offset = 1; ; offset++) {
        const candidate = shiftDate(day.date, -offset)
        if (candidate <= from) break
        if ((countByDate[candidate] || 0) < limit) {
          target = candidate
          break
        }
      }
      if (target) {
        countByDate[target] = (countByDate[target] || 0) + 1
        countByDate[day.date] = Math.max(0, (countByDate[day.date] || 1) - 1)
        suggestions.push({ task, from: day.date, to: target })
      }
    }
  }
  return suggestions
}
