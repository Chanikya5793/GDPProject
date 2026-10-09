// Splits tasks into one section per due date for the Tasks page.

/**
 * Groups tasks by `dueDate` ('YYYY-MM-DD'), earliest first, with undated tasks
 * last. Tasks keep their incoming order within a group, so the caller's sort
 * decides how each day reads.
 *
 * `overdue` marks a past date that still has unfinished work; a past day whose
 * tasks are all done is not flagged, matching how a task card treats them.
 */
export function groupTasksByDate(tasks, todayStr) {
  const groups = new Map()
  for (const task of tasks) {
    const date = task.dueDate || ''
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(task)
  }
  return [...groups]
    .sort(([a], [b]) => {
      if (!a) return b ? 1 : 0
      if (!b) return -1
      return a.localeCompare(b)
    })
    .map(([date, groupTasks]) => ({
      date,
      tasks: groupTasks,
      isToday: date === todayStr,
      overdue: Boolean(date) && date < todayStr && groupTasks.some(task => !task.completed),
    }))
}
