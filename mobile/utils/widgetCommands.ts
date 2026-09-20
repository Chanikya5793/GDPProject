import type { Reminder, Task } from '@/types';

export interface WidgetCommand {
  id: string;
  owner: string;
  kind: 'task' | 'reminder';
  recordId: string;
  revision?: number | null;
  date: string;
  time: string;
  createdAt: number;
}

/** Resolve against current records, never toggle and never trust a stale ID alone. */
export function resolveWidgetCommand(command: WidgetCommand, owner: string, records: (Task | Reminder)[]) {
  if (command.owner !== owner || !['task', 'reminder'].includes(command.kind)) return { status: 'discard' } as const;
  const record = records.find(item => String(item.id) === command.recordId);
  if (!record) return { status: 'discard' } as const;
  if (record.completed) return { status: 'applied' } as const;
  const date = 'dueDate' in record ? record.dueDate : record.date;
  const time = 'dueTime' in record ? record.dueTime : record.time;
  if ((record._revision ?? null) !== (command.revision ?? null) || date !== command.date || time !== command.time) {
    return { status: 'stale' } as const;
  }
  return { status: 'complete', record } as const;
}
