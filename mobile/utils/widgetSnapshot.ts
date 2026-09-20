import type { Reminder, Task } from '@/types';
import { parseLocalDateTime } from './notificationPlan';

export const MAX_TITLE_LENGTH = 100;

export interface WidgetItem {
  id: string;
  kind: 'task' | 'reminder';
  title: string;
  date: string;
  time: string;
  category: string;
  priority: string;
  done: boolean;
  revision: number | null;
  pending: boolean;
}

export interface WidgetSnapshot {
  schema: 1;
  owner: string;
  updatedAt: number;
  titlesAllowed: boolean;
  items: WidgetItem[];
}

/** Native WidgetKit computes dates and filters from this single minimized copy.
 * No notes, identity, credentials, or custom category names without title consent.
 * Do not cap the records: doing so silently corrupts counts and filtered agendas.
 */
export function buildWidgetSnapshot(input: {
  tasks: Task[]; reminders: Reminder[]; now: number; showTitles: boolean; owner: string;
}): WidgetSnapshot {
  const items: WidgetItem[] = [];
  for (const [kind, records] of [['task', input.tasks], ['reminder', input.reminders]] as const) {
    for (const record of records) {
      const date = 'dueDate' in record ? record.dueDate : record.date;
      const time = 'dueTime' in record ? record.dueTime : record.time;
      if (date && parseLocalDateTime(date, time, 0) === null) continue;
      if (time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) continue;
      const rawTitle = input.showTitles ? record.title.trim() : '';
      const title = Array.from(rawTitle).length > MAX_TITLE_LENGTH
        ? Array.from(rawTitle).slice(0, MAX_TITLE_LENGTH - 1).join('') + '…' : rawTitle;
      items.push({
        id: String(record.id), kind, title, date, time,
        category: input.showTitles && 'category' in record ? record.category.slice(0, 40) : '',
        priority: 'priority' in record ? record.priority : '',
        done: Boolean(record.completed), revision: record._revision ?? null,
        pending: Boolean(record._pending),
      });
    }
  }
  return { schema: 1, owner: input.owner, updatedAt: input.now, titlesAllowed: input.showTitles, items };
}
