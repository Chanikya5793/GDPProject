import { PlannerRecordId, Task } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';
import { createPlannerItem, deletePlannerItem, listPlannerItems, updatePlannerItem } from './plannerClient';
import { addLog } from './logs';

const KEY = 'nw_tasks';

async function load(): Promise<Task[]> {
  return getItem<Task[]>(KEY, []);
}

async function save(tasks: Task[]): Promise<void> {
  await setItem(KEY, tasks);
}

export async function getTasks(userId: string): Promise<Task[]> {
  return (await listPlannerItems<Task>('task')).filter(t => t.userId === userId);
}

export async function createTask(task: Partial<Task> & { userId: string; title: string }): Promise<Task> {
  const newTask: Task = {
    id: Date.now(),
    userId: task.userId,
    title: task.title,
    dueDate: task.dueDate || '',
    dueTime: task.dueTime || '',
    priority: task.priority || 'medium',
    category: task.category || 'Homework',
    notes: task.notes || '',
    completed: false,
    createdAt: new Date().toISOString(),
  };
  const created = await createPlannerItem('task', newTask);
  await addLog('created', 'task', created.title, { entityId: created.id, after: created });
  return created;
}

export async function updateTask(id: PlannerRecordId, updates: Partial<Task>): Promise<Task> {
  // Snapshot first: the log entry is only rollbackable if it carries `before`.
  const before = (await listPlannerItems<Task>('task')).find(t => String(t.id) === String(id));
  const updated = await updatePlannerItem<Task>('task', id, updates);
  await addLog('updated', 'task', updated.title, { entityId: id, before, after: updated });
  return updated;
}

export async function deleteTask(id: PlannerRecordId): Promise<void> {
  const tasks = await load();
  const task = tasks.find(t => t.id === id);
  let trashId: string | undefined;
  if (task) trashId = await addToTrash(task, 'task');
  await deletePlannerItem('task', id);
  await addLog('deleted', 'task', task?.title || '', { entityId: id, before: task, trashId });
}

export async function toggleTask(id: PlannerRecordId): Promise<Task> {
  const tasks = await load();
  const task = tasks.find(t => t.id === id);
  if (!task) throw new Error('Task not found');
  const updated = await updatePlannerItem<Task>('task', id, { completed: !task.completed });
  await addLog(updated.completed ? 'completed' : 'reopened', 'task', updated.title, {
    entityId: id, before: task, after: updated,
  });
  return updated;
}

export async function restoreTaskDirect(task: Task): Promise<void> {
  await createPlannerItem('task', task);
}

export async function batchUpdateTasks(
  updates: Array<{ id: PlannerRecordId; changes: Partial<Task> }>,
): Promise<void> {
  const before = await listPlannerItems<Task>('task');
  const updated = await Promise.all(
    updates.map(update => updatePlannerItem<Task>('task', update.id, update.changes)),
  );
  // Sequential: addLog read-modify-writes one store, so concurrent calls would
  // drop entries. Auto-balance moves tasks without a tap, so these must land.
  for (const task of updated) {
    const prior = before.find(item => String(item.id) === String(task.id));
    await addLog('updated', 'task', task.title, { entityId: task.id, before: prior, after: task });
  }
}
