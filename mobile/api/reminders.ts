import { PlannerRecordId, Reminder } from '@/types';
import { getItem, setItem } from './storage';
import { addToTrash } from './trash';
import { createPlannerItem, deletePlannerItem, listPlannerItems, updatePlannerItem } from './plannerClient';

const KEY = 'nw_reminders';

async function load(): Promise<Reminder[]> {
  return getItem<Reminder[]>(KEY, []);
}

async function save(reminders: Reminder[]): Promise<void> {
  await setItem(KEY, reminders);
}

export async function getReminders(userId: string): Promise<Reminder[]> {
  return (await listPlannerItems<Reminder>('reminder')).filter(r => r.userId === userId);
}

export async function createReminder(rem: Partial<Reminder> & { userId: string; title: string }): Promise<Reminder> {
  const newRem: Reminder = {
    id: Date.now(),
    userId: rem.userId,
    title: rem.title,
    date: rem.date || '',
    time: rem.time || '',
    notes: rem.notes || '',
    createdAt: new Date().toISOString(),
  };
  return createPlannerItem('reminder', newRem);
}

export async function updateReminder(id: PlannerRecordId, updates: Partial<Reminder>): Promise<Reminder> {
  return updatePlannerItem<Reminder>('reminder', id, updates);
}

export async function deleteReminder(id: PlannerRecordId): Promise<void> {
  const all = await load();
  const rem = all.find(r => r.id === id);
  if (rem) await addToTrash(rem, 'reminder');
  await deletePlannerItem('reminder', id);
}

export async function restoreReminderDirect(rem: Reminder): Promise<void> {
  await createPlannerItem('reminder', rem);
}
