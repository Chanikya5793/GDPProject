import { apiRequest, idempotencyKey } from './client';
import { getItem, setItem } from './storage';
import { preserveAttachments } from '@/utils/attachments';
import { Note, PlannerRecordId, Reminder, Task } from '@/types';
import { auth } from '@/lib/firebase';

type Kind = 'task' | 'reminder' | 'note';
type PlannerItem = Task | Reminder | Note;

interface ServerRecord {
  record_id: string;
  revision: number;
  approved_for_ai: boolean;
  created_at: string;
  updated_at: string;
  content: Record<string, unknown> & { entity_type: Kind; title: string };
}

interface OutboxOperation {
  method: 'PUT' | 'DELETE';
  kind: Kind;
  recordId: PlannerRecordId;
  body: Record<string, unknown>;
}

const cacheKey = (kind: Kind) => `nw_${kind === 'note' ? 'notes' : `${kind}s`}`;

function currentUid(): string {
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error('Sign in is required');
  return uid;
}

function fromServer(record: ServerRecord): PlannerItem {
  const common = {
    id: /^\d+$/.test(record.record_id) ? Number(record.record_id) : record.record_id,
    userId: currentUid(), _revision: record.revision,
    _approvedForAi: record.approved_for_ai, createdAt: record.created_at,
  };
  if (record.content.entity_type === 'task') return {
    ...common, title: record.content.title, dueDate: String(record.content.due_date || ''),
    dueTime: String(record.content.due_time || ''), priority: (record.content.priority || 'medium') as Task['priority'],
    category: String(record.content.category || 'Other'), notes: String(record.content.notes || ''),
    completed: Boolean(record.content.completed),
    seriesId: (record.content.series_id as string) || null,
    recurrence: (record.content.recurrence as Task['recurrence']) || null,
  };
  if (record.content.entity_type === 'reminder') return {
    ...common, title: record.content.title, date: String(record.content.date || ''),
    time: String(record.content.time || ''), notes: String(record.content.notes || ''),
    seriesId: (record.content.series_id as string) || null,
    recurrence: (record.content.recurrence as Reminder['recurrence']) || null,
  };
  return {
    ...common, title: record.content.title, body: String(record.content.body || ''),
    tagIds: (record.content.tag_ids as Array<string | number> || []).map(Number),
    updatedAt: record.updated_at,
  };
}

function toServer(kind: Kind, item: PlannerItem): Record<string, unknown> {
  if (kind === 'task') {
    const task = item as Task;
    return {
      entity_type: 'task', title: task.title, due_date: task.dueDate || null,
      due_time: task.dueTime || null, priority: task.priority, category: task.category,
      notes: task.notes, completed: task.completed, estimated_minutes: 30,
      series_id: task.seriesId || null, recurrence: task.recurrence || null,
    };
  }
  if (kind === 'reminder') {
    const reminder = item as Reminder;
    return {
      entity_type: 'reminder', title: reminder.title, date: reminder.date,
      time: reminder.time || null, notes: reminder.notes, completed: false,
      series_id: reminder.seriesId || null, recurrence: reminder.recurrence || null,
    };
  }
  const note = item as Note;
  return {
    entity_type: 'note', title: note.title, body: note.body,
    tag_ids: note.tagIds.map(String), attachments: [],
  };
}

/**
 * Carry device-only fields from the copy we hold onto a server-derived record.
 *
 * Note attachments never leave the device (toServer sends an empty list), so a
 * record coming back from the server always has none. Caching it as-is would
 * destroy every attachment the moment a request succeeded.
 */
function withLocalOnlyFields<T extends PlannerItem>(kind: Kind, saved: T, local: T | undefined): T {
  if (kind !== 'note') return saved;
  const attachments = preserveAttachments(
    (local as Note | undefined)?.attachments,
    (saved as Note).attachments,
  );
  return attachments === undefined ? saved : { ...saved, attachments } as T;
}

/**
 * Keep the AI index in step with a record's approval.
 *
 * Approval alone does nothing: a record is only reachable by the copilot once it
 * is indexed. Mobile never called this, so every record created on the phone was
 * invisible to the assistant no matter how it was flagged.
 */
async function synchronizeIndex(kind: Kind, item: PlannerItem): Promise<void> {
  const path = `/v1/index/${kind}/${encodeURIComponent(String(item.id))}`;
  if (item._approvedForAi ?? true) {
    await apiRequest(path, {
      method: 'POST',
      body: JSON.stringify({ approved: true, expected_revision: item._revision }),
    });
  } else {
    await apiRequest(path, { method: 'DELETE' });
  }
}

async function loadCache(kind: Kind): Promise<PlannerItem[]> {
  return getItem<PlannerItem[]>(cacheKey(kind), []);
}

async function saveCache(kind: Kind, items: PlannerItem[]): Promise<void> {
  await setItem(cacheKey(kind), items);
}

async function send(operation: OutboxOperation): Promise<ServerRecord | undefined> {
  return apiRequest<ServerRecord | undefined>(
    `/v1/records/${operation.kind}/${operation.recordId}`,
    { method: operation.method, body: JSON.stringify(operation.body) },
  );
}

async function queue(operation: OutboxOperation): Promise<void> {
  const outbox = await getItem<OutboxOperation[]>('nw_sync_outbox', []);
  await setItem('nw_sync_outbox', [...outbox, operation]);
}

export async function flushOutbox(): Promise<number> {
  const outbox = await getItem<OutboxOperation[]>('nw_sync_outbox', []);
  const remaining: OutboxOperation[] = [];
  for (const operation of outbox) {
    try { await send(operation); }
    catch (error) {
      remaining.push(operation);
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 409) break;
    }
  }
  await setItem('nw_sync_outbox', remaining);
  return remaining.length;
}

export async function listPlannerItems<T extends PlannerItem>(kind: Kind): Promise<T[]> {
  try {
    await flushOutbox();
    const records = await apiRequest<ServerRecord[]>(`/v1/records/${kind}`);
    const cached = kind === 'note' ? await loadCache(kind) as T[] : [];
    const items = records.map(record => {
      const saved = fromServer(record) as T;
      const local = cached.find(item => String(item.id) === String(saved.id));
      return withLocalOnlyFields(kind, saved, local);
    });
    await saveCache(kind, items);
    return items;
  } catch {
    return await loadCache(kind) as T[];
  }
}

export async function createPlannerItem<T extends PlannerItem>(kind: Kind, item: T): Promise<T> {
  const operation: OutboxOperation = {
    method: 'PUT', kind, recordId: item.id,
    body: {
      content: toServer(kind, item), expected_revision: null,
      idempotency_key: idempotencyKey(`mobile-create-${kind}`),
      // Visible to the assistant unless the record says otherwise, matching web.
      approved_for_ai: item._approvedForAi ?? true,
    },
  };
  try {
    const server = await send(operation);
    const saved = withLocalOnlyFields(kind, fromServer(server!) as T, item);
    await saveCache(kind, [...await loadCache(kind), saved]);
    // The record is already saved; privacy settings may legitimately refuse the
    // index, and that must not turn a successful write into a failure.
    try { await synchronizeIndex(kind, saved); } catch { /* approval persists */ }
    return saved;
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status < 500) throw error;
    await queue(operation);
    await saveCache(kind, [...await loadCache(kind), { ...item, _revision: 1, _pending: true }]);
    return { ...item, _revision: 1, _pending: true };
  }
}

export async function updatePlannerItem<T extends PlannerItem>(kind: Kind, id: PlannerRecordId, updates: Partial<T>): Promise<T> {
  const items = await loadCache(kind) as T[];
  const current = items.find(item => item.id === id);
  if (!current) throw new Error('Record is unavailable in the encrypted cache');
  const merged = { ...current, ...updates } as T;
  const operation: OutboxOperation = {
    method: 'PUT', kind, recordId: id,
    body: {
      content: toServer(kind, merged), expected_revision: current._revision,
      idempotency_key: idempotencyKey(`mobile-update-${kind}`),
      approved_for_ai: merged._approvedForAi ?? true,
    },
  };
  try {
    const saved = withLocalOnlyFields(kind, fromServer((await send(operation))!) as T, merged);
    await saveCache(kind, items.map(item => item.id === id ? saved : item));
    try { await synchronizeIndex(kind, saved); } catch { /* approval persists */ }
    return saved;
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status < 500) throw error;
    await queue(operation);
    const pending = { ...merged, _pending: true };
    await saveCache(kind, items.map(item => item.id === id ? pending : item));
    return pending;
  }
}

export async function deletePlannerItem(kind: Kind, id: PlannerRecordId): Promise<void> {
  const items = await loadCache(kind);
  const current = items.find(item => item.id === id);
  if (!current) return;
  const operation: OutboxOperation = {
    method: 'DELETE', kind, recordId: id,
    body: {
      expected_revision: current._revision,
      idempotency_key: idempotencyKey(`mobile-delete-${kind}`),
    },
  };
  try { await send(operation); }
  catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status < 500) throw error;
    await queue(operation);
  }
  await saveCache(kind, items.filter(item => item.id !== id));
}
