// Splits tasks into one section per due date for the Tasks screen (same rules as the web page).

export interface TaskDateGroup<T> {
  /** 'YYYY-MM-DD', or '' for tasks without a due date. */
  date: string;
  tasks: T[];
  isToday: boolean;
  /** A past day that still has unfinished work; a past day whose tasks are all done is not flagged. */
  overdue: boolean;
}

/**
 * Groups tasks by `dueDate`, earliest first, with undated tasks last. Tasks
 * keep their incoming order within a group, so the caller's sort decides how
 * each day reads.
 */
export function groupTasksByDate<T extends { dueDate?: string | null; completed?: boolean }>(
  tasks: T[], todayStr: string,
): TaskDateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const date = task.dueDate || '';
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(task);
  }
  return [...groups]
    .sort(([a], [b]) => {
      if (!a) return b ? 1 : 0;
      if (!b) return -1;
      return a.localeCompare(b);
    })
    .map(([date, groupTasks]) => ({
      date,
      tasks: groupTasks,
      isToday: date === todayStr,
      overdue: Boolean(date) && date < todayStr && groupTasks.some(task => !task.completed),
    }));
}

/** Due date first; within a day, timed tasks in clock order, then the untimed ones. */
export function compareByDue(
  a: { dueDate?: string | null; dueTime?: string | null },
  b: { dueDate?: string | null; dueTime?: string | null },
): number {
  return (a.dueDate || '').localeCompare(b.dueDate || '')
    || (a.dueTime || '24:00').localeCompare(b.dueTime || '24:00');
}
