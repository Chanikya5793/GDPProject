import { PlannerRecordId, Task } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';
import { createPlannerItem, deletePlannerItem, listPlannerItems, updatePlannerItem } from './plannerClient';

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
  return createPlannerItem('task', newTask);
}

export async function updateTask(id: PlannerRecordId, updates: Partial<Task>): Promise<Task> {
  return updatePlannerItem<Task>('task', id, updates);
}

export async function deleteTask(id: PlannerRecordId): Promise<void> {
  const tasks = await load();
  const task = tasks.find(t => t.id === id);
  if (task) await addToTrash(task, 'task');
  await deletePlannerItem('task', id);
}

export async function toggleTask(id: PlannerRecordId): Promise<Task> {
  const tasks = await load();
  const task = tasks.find(t => t.id === id);
  if (!task) throw new Error('Task not found');
  return updatePlannerItem<Task>('task', id, { completed: !task.completed });
}

export async function restoreTaskDirect(task: Task): Promise<void> {
  await createPlannerItem('task', task);
}

export async function batchUpdateTasks(
  updates: Array<{ id: PlannerRecordId; changes: Partial<Task> }>,
): Promise<void> {
  await Promise.all(updates.map(update => updatePlannerItem<Task>('task', update.id, update.changes)));
}
