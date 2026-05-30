import { Task } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';

const KEY = 'nw_tasks';

function defaultTasks(): Task[] {
  const now = Date.now();
  return [
    {
      id: 1, userId: 1, title: 'Read Chapter 5 - Organic Chemistry',
      dueDate: new Date(now + 86400000).toISOString().split('T')[0],
      dueTime: '23:59', priority: 'high', category: 'Reading',
      notes: 'Focus on the different compounds', completed: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 2, userId: 1, title: 'Complete Lab Report',
      dueDate: new Date(now + 172800000).toISOString().split('T')[0],
      dueTime: '17:00', priority: 'high', category: 'Lab',
      notes: 'Include all data tables', completed: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 3, userId: 1, title: 'Study for CS Midterm',
      dueDate: new Date(now + 432000000).toISOString().split('T')[0],
      dueTime: '', priority: 'medium', category: 'Exam',
      notes: 'Chapters 1-6', completed: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 4, userId: 1, title: 'Submit History Essay',
      dueDate: new Date(now - 86400000).toISOString().split('T')[0],
      dueTime: '23:59', priority: 'high', category: 'Homework',
      notes: '', completed: true,
      createdAt: new Date().toISOString(),
    },
  ];
}

async function load(): Promise<Task[]> {
  return getItem<Task[]>(KEY, defaultTasks());
}

async function save(tasks: Task[]): Promise<void> {
  await setItem(KEY, tasks);
}

export async function getTasks(userId: number): Promise<Task[]> {
  const tasks = await load();
  return tasks.filter(t => t.userId === userId);
}

export async function createTask(task: Partial<Task> & { userId: number; title: string }): Promise<Task> {
  const tasks = await load();
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
  await save([...tasks, newTask]);
  return newTask;
}

export async function updateTask(id: number, updates: Partial<Task>): Promise<Task> {
  const tasks = await load();
  const updated = tasks.map(t => t.id === id ? { ...t, ...updates } : t);
  await save(updated);
  return updated.find(t => t.id === id)!;
}

export async function deleteTask(id: number): Promise<void> {
  const tasks = await load();
  const task = tasks.find(t => t.id === id);
  if (task) await addToTrash(task, 'task');
  await save(tasks.filter(t => t.id !== id));
}

export async function toggleTask(id: number): Promise<Task> {
  const tasks = await load();
  const updated = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
  await save(updated);
  return updated.find(t => t.id === id)!;
}

export async function restoreTaskDirect(task: Task): Promise<void> {
  const tasks = await load();
  tasks.push(task);
  await save(tasks);
}

export async function batchUpdateTasks(
  updates: Array<{ id: number; changes: Partial<Task> }>,
): Promise<void> {
  const tasks = await load();
  const map = new Map(updates.map(u => [u.id, u.changes]));
  const updated = tasks.map(t => (map.has(t.id) ? { ...t, ...map.get(t.id)! } : t));
  await save(updated);
}
