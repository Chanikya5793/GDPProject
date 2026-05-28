import { Reminder } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';

const KEY = 'nw_reminders';

function defaultReminders(): Reminder[] {
  const now = Date.now();
  return [
    {
      id: 1, userId: 1, title: 'Advisor Meeting',
      date: new Date(now + 86400000).toISOString().split('T')[0],
      time: '10:00', notes: 'Discuss spring course schedule',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2, userId: 1, title: 'Study Group - Library room 204',
      date: new Date(now + 172800000).toISOString().split('T')[0],
      time: '14:00', notes: 'Bring organic chemistry notes',
      createdAt: new Date().toISOString(),
    },
    {
      id: 3, userId: 1, title: 'Office Hours - Prof. Fellah',
      date: new Date(now + 259200000).toISOString().split('T')[0],
      time: '09:30', notes: 'Ask about assignment formatting',
      createdAt: new Date().toISOString(),
    },
  ];
}

async function load(): Promise<Reminder[]> {
  return getItem<Reminder[]>(KEY, defaultReminders());
}

async function save(reminders: Reminder[]): Promise<void> {
  await setItem(KEY, reminders);
}

export async function getReminders(userId: number): Promise<Reminder[]> {
  const all = await load();
  return all.filter(r => r.userId === userId);
}

export async function createReminder(rem: Partial<Reminder> & { userId: number; title: string }): Promise<Reminder> {
  const all = await load();
  const newRem: Reminder = {
    id: Date.now(),
    userId: rem.userId,
    title: rem.title,
    date: rem.date || '',
    time: rem.time || '',
    notes: rem.notes || '',
    createdAt: new Date().toISOString(),
  };
  await save([...all, newRem]);
  return newRem;
}

export async function updateReminder(id: number, updates: Partial<Reminder>): Promise<Reminder> {
  const all = await load();
  const updated = all.map(r => r.id === id ? { ...r, ...updates } : r);
  await save(updated);
  return updated.find(r => r.id === id)!;
}

export async function deleteReminder(id: number): Promise<void> {
  const all = await load();
  const rem = all.find(r => r.id === id);
  if (rem) await addToTrash(rem, 'reminder');
  await save(all.filter(r => r.id !== id));
}

export async function restoreReminderDirect(rem: Reminder): Promise<void> {
  const all = await load();
  all.push(rem);
  await save(all);
}
