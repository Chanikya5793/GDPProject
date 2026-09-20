import { ApiError, apiRequest, idempotencyKey } from './client';
import { getItem, getStorageUid, setItem } from './storage';
import { preserveAttachments } from '@/utils/attachments';
import { Note, PlannerRecordId, Reminder, ServerAttachment, Task } from '@/types';
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
const recordOperations = new Map<string, Promise<unknown>>();

// Widget completions and a foreground refresh can arrive together. Serialize
// cache reads and writes per account so an older fetch cannot undo a completion.
function serializeRecords<T>(kind: Kind | 'outbox', operation: () => Promise<T>): Promise<T> {
  const uid = getStorageUid();
  const key = `${uid}:${kind}`;
  const run = (recordOperations.get(key) ?? Promise.resolve()).catch(() => {}).then(() => {
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    return operation();
  });
  recordOperations.set(key, run);
  void run.finally(() => { if (recordOperations.get(key) === run) recordOperations.delete(key); }).catch(() => {});
  return run;
}

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
    keepScheduled: Boolean(record.content.keep_scheduled),
    seriesId: (record.content.series_id as string) || null,
    recurrence: (record.content.recurrence as Task['recurrence']) || null,
  };
  if (record.content.entity_type === 'reminder') return {
    ...common, title: record.content.title, date: String(record.content.date || ''),
    time: String(record.content.time || ''), notes: String(record.content.notes || ''),
    completed: Boolean(record.content.completed),
    seriesId: (record.content.series_id as string) || null,
    recurrence: (record.content.recurrence as Reminder['recurrence']) || null,
  };
  const tagIds = (record.content.tag_ids as Array<string | number> || []).map(String);
  const attachments = (record.content.attachments as ServerAttachment[] | undefined) || [];
  return {
    ...common, title: record.content.title, body: String(record.content.body || ''),
    // This app's tags have numeric ids; the web's are strings. Anything not
    // ours is kept aside and sent back as-is rather than coerced to NaN.
    tagIds: tagIds.filter(isNumericId).map(Number),
    _foreignTagIds: tagIds.filter(id => !isNumericId(id)),
    _serverAttachments: attachments.filter(item => item && typeof item.text === 'string'),
    updatedAt: record.updated_at,
  };
}

const isNumericId = (value: string) => /^\d+$/.test(value);

function toServer(kind: Kind, item: PlannerItem): Record<string, unknown> {
  if (kind === 'task') {
    const task = item as Task;
    return {
      entity_type: 'task', title: task.title, due_date: task.dueDate || null,
      due_time: task.dueTime || null, priority: task.priority, category: task.category,
      notes: task.notes, completed: task.completed, estimated_minutes: 30,
      keep_scheduled: Boolean(task.keepScheduled),
      series_id: task.seriesId || null, recurrence: task.recurrence || null,
    };
  }
  if (kind === 'reminder') {
    const reminder = item as Reminder;
    return {
      entity_type: 'reminder', title: reminder.title, date: reminder.date,
      time: reminder.time || null, notes: reminder.notes,
      completed: Boolean(reminder.completed),
      series_id: reminder.seriesId || null, recurrence: reminder.recurrence || null,
    };
  }
  const note = item as Note;
  return {
    entity_type: 'note', title: note.title, body: note.body,
    tag_ids: [...note.tagIds.map(String), ...(note._foreignTagIds || [])],
    // Image attachments stay on the device; the web's text attachments are
    // the server's and go back exactly as they came.
    attachments: note._serverAttachments || [],
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

const dataListeners = new Set<() => void>();

/**
 * Subscribe to any change in the cached planner records.
 *
 * Every create, edit, delete and refresh lands in `saveCache`, which makes this
 * the one place that knows the records moved. Notification scheduling hangs off
 * it so an alert cannot drift out of step with the task it belongs to — no
 * screen has to remember to keep it in sync.
 */
export function onPlannerDataChanged(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => { dataListeners.delete(listener); };
}

async function saveCache(kind: Kind, items: PlannerItem[]): Promise<void> {
  await setItem(cacheKey(kind), items);
  // Listeners are advisory; one throwing must not fail the write that caused it.
  for (const listener of dataListeners) {
    try { listener(); } catch { /* ignore */ }
  }
}

async function send(operation: OutboxOperation): Promise<ServerRecord | undefined> {
  return apiRequest<ServerRecord | undefined>(
    `/v1/records/${operation.kind}/${operation.recordId}`,
    { method: operation.method, body: JSON.stringify(operation.body) },
  );
}

const statusOf = (error: unknown): number | undefined =>
  error instanceof Error && 'status' in error ? (error as { status?: number }).status : undefined;
const codeOf = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;

// There is no server in the demo build (or one this build cannot reach by
// configuration). Keeping a change "for later" there grew the outbox with
// every edit and replayed all of it, failing, on every list.
const isUnconfigured = (error: unknown) => codeOf(error) === 'not_configured';

// Errors that will not go away by retrying: the request itself was refused.
// A network failure has no status; a 5xx is worth another try once the
// connection is back.
function isPermanentFailure(error: unknown): boolean {
  const status = statusOf(error);
  return Boolean(status && status < 500) && !isUnconfigured(error);
}

async function keepForLater(operation: OutboxOperation, error: unknown, expectedUid = getStorageUid()): Promise<void> {
  if (isUnconfigured(error)) return;
  await queue(operation, expectedUid);
}

async function queue(operation: OutboxOperation, expectedUid = getStorageUid()): Promise<void> {
  await serializeRecords('outbox', async () => {
    const outbox = await getItem<OutboxOperation[]>('nw_sync_outbox', []);
    if (getStorageUid() !== expectedUid) throw new ApiError('Account changed.', 401);
    await setItem('nw_sync_outbox', [...outbox, operation]);
  });
}

export async function flushOutbox(): Promise<number> {
  return serializeRecords('outbox', flushOutboxNow);
}

/**
 * Send everything queued while offline, in order.
 *
 * Revisions are chained through the flush: an offline edit is queued with
 * the revision the device last saw, so a second edit of the same record
 * carried the same number and was refused once the first had landed. Each
 * success feeds its new revision into the next operation on that record.
 *
 * A refusal the server will repeat -- a stale revision, a record deleted
 * elsewhere -- drops that operation and moves on; the next list refreshes
 * the record from the server. Keeping it used to block every operation
 * behind it, on every load, for good. Only a failure to reach the server
 * keeps the queue, and then the whole rest of it, in order.
 */
async function flushOutboxNow(): Promise<number> {
  const uid = getStorageUid();
  const outbox = await getItem<OutboxOperation[]>('nw_sync_outbox', []);
  if (!outbox.length) return 0;
  const remaining: OutboxOperation[] = [];
  const revisions = new Map<string, number>();
  let unreachable = false;
  for (const operation of outbox) {
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    if (unreachable) { remaining.push(operation); continue; }
    const recordKey = `${operation.kind}:${operation.recordId}`;
    const known = revisions.get(recordKey);
    const body = known === undefined ? operation.body : { ...operation.body, expected_revision: known };
    try {
      const result = await send({ ...operation, body });
      if (operation.method === 'DELETE') revisions.delete(recordKey);
      else if (result?.revision) revisions.set(recordKey, result.revision);
    } catch (error) {
      if (isUnconfigured(error) || isPermanentFailure(error)) continue;
      unreachable = true;
      remaining.push(operation);
    }
  }
  if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
  await setItem('nw_sync_outbox', remaining);
  return remaining.length;
}

export async function listPlannerItems<T extends PlannerItem>(kind: Kind): Promise<T[]> {
  return serializeRecords(kind, () => listPlannerItemsNow<T>(kind));
}

async function listPlannerItemsNow<T extends PlannerItem>(kind: Kind): Promise<T[]> {
  const uid = getStorageUid();
  try {
    await flushOutbox();
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    const records = await apiRequest<ServerRecord[]>(`/v1/records/${kind}`);
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    const cached = kind === 'note' ? await loadCache(kind) as T[] : [];
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    const items = records.map(record => {
      const saved = fromServer(record) as T;
      const local = cached.find(item => String(item.id) === String(saved.id));
      return withLocalOnlyFields(kind, saved, local);
    });
    await saveCache(kind, items);
    return items;
  } catch {
    if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401);
    return await loadCache(kind) as T[];
  }
}

export async function createPlannerItem<T extends PlannerItem>(kind: Kind, item: T): Promise<T> {
  // Under the same lock as every other write to this kind: a widget completion
  // landing between this read of the cache and its write used to be undone.
  return serializeRecords(kind, () => createPlannerItemNow(kind, item));
}

async function createPlannerItemNow<T extends PlannerItem>(kind: Kind, item: T): Promise<T> {
  const uid = getStorageUid();
  const assertScope = () => { if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401); };
  const operation: OutboxOperation = {
    method: 'PUT', kind, recordId: item.id,
    body: {
      content: toServer(kind, item), expected_revision: null,
      idempotency_key: idempotencyKey(`mobile-create-${kind}`),
      // Visible to the assistant unless the record says otherwise, matching web.
      approved_for_ai: item._approvedForAi ?? true,
    },
  };
  let saved: T;
  try {
    const server = await send(operation);
    assertScope();
    saved = withLocalOnlyFields(kind, fromServer(server!) as T, item);
  } catch (error) {
    assertScope();
    if (isPermanentFailure(error)) throw error;
    saved = { ...item, _revision: 1, _pending: !isUnconfigured(error) };
    await keepForLater(operation, error, uid);
  }
  assertScope();
  const items = await loadCache(kind);
  assertScope();
  await saveCache(kind, [...items.filter(existing => String(existing.id) !== String(item.id)), saved]);
  if (!saved._pending) {
    // The record is already saved; privacy settings may legitimately refuse
    // the index, and that must not turn a successful write into a failure.
    try { await synchronizeIndex(kind, saved); } catch { /* approval persists */ }
  }
  return saved;
}

export async function updatePlannerItem<T extends PlannerItem>(kind: Kind, id: PlannerRecordId, updates: Partial<T>,
  expected?: { userId: string; revision: number | null; date: string; time: string },
): Promise<T> {
  return serializeRecords(kind, () => updatePlannerItemNow(kind, id, updates, expected));
}

async function updatePlannerItemNow<T extends PlannerItem>(kind: Kind, id: PlannerRecordId, updates: Partial<T>,
  expected?: { userId: string; revision: number | null; date: string; time: string },
): Promise<T> {
  const operationUid = getStorageUid();
  const assertScope = () => {
    if (getStorageUid() !== operationUid || (expected && operationUid !== expected.userId)) {
      throw new ApiError('Account changed.', 401);
    }
  };
  assertScope();
  const items = await loadCache(kind) as T[];
  assertScope();
  const current = items.find(item => item.id === id);
  if (!current) throw new Error('Record is unavailable in the encrypted cache');
  if (expected) {
    const date = 'dueDate' in current ? current.dueDate : 'date' in current ? current.date : '';
    const time = 'dueTime' in current ? current.dueTime : 'time' in current ? current.time : '';
    if (current.userId !== expected.userId || (current._revision ?? null) !== expected.revision ||
        date !== expected.date || time !== expected.time) throw new ApiError('Item changed.', 409);
  }
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
    const server = await send(operation);
    assertScope();
    const saved = withLocalOnlyFields(kind, fromServer(server!) as T, merged);
    await saveCache(kind, items.map(item => item.id === id ? saved : item));
    assertScope();
    try { await synchronizeIndex(kind, saved); } catch { /* approval persists */ }
    return saved;
  } catch (error) {
    assertScope();
    if (isPermanentFailure(error)) throw error;
    await keepForLater(operation, error, operationUid);
    assertScope();
    const pending = { ...merged, _pending: !isUnconfigured(error) };
    await saveCache(kind, items.map(item => item.id === id ? pending : item));
    return pending;
  }
}

export async function deletePlannerItem(kind: Kind, id: PlannerRecordId): Promise<void> {
  return serializeRecords(kind, () => deletePlannerItemNow(kind, id));
}

async function deletePlannerItemNow(kind: Kind, id: PlannerRecordId): Promise<void> {
  const uid = getStorageUid();
  const assertScope = () => { if (getStorageUid() !== uid) throw new ApiError('Account changed.', 401); };
  const items = await loadCache(kind);
  assertScope();
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
    assertScope();
    // Already gone on the server is the outcome asked for.
    if (statusOf(error) === 404) { /* fall through to the cache */ }
    else if (isPermanentFailure(error)) throw error;
    else await keepForLater(operation, error, uid);
  }
  assertScope();
  await saveCache(kind, items.filter(item => item.id !== id));
}
