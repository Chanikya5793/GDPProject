// Activity log storage — the mobile counterpart of src/api/logs.js.
//
// Entries go through api/storage, which encrypts them and namespaces the key by
// the signed-in uid, so one account never sees another's history. Web reaches
// the same guarantee via secureCollections + authenticatedUid.

import * as Crypto from 'expo-crypto';

import { getItem, setItem } from './storage';
import { LogAction, LogEntity, LogEntry } from '@/types';

const NAMESPACE = 'audit:activity';
const MAX_LOGS = 300;
const DEDUPE_WINDOW_MS = 5000;

export const SESSION_ID = `s_${Date.now()}_${Crypto.randomUUID().slice(0, 7)}`;
const SESSION_START = new Date().toISOString();

let suppressDepth = 0;

/**
 * Run a callback with logging disabled.
 *
 * Rollback uses this: undoing a change calls the same entity APIs a user would,
 * and without suppression each undo would append its own "updated" entry and the
 * log would grow every time someone reverted something.
 */
export async function suppressLogging<T>(callback: () => Promise<T>): Promise<T> {
  suppressDepth += 1;
  try {
    return await callback();
  } finally {
    suppressDepth -= 1;
  }
}

async function load(): Promise<LogEntry[]> {
  return getItem<LogEntry[]>(NAMESPACE, []);
}

async function save(logs: LogEntry[]): Promise<void> {
  return setItem(NAMESPACE, logs.slice(0, MAX_LOGS));
}

/**
 * Drop attachment binaries from a snapshot, keeping only their metadata.
 *
 * Snapshots are kept for every change; storing base64 payloads would blow past
 * the storage budget after a handful of edits.
 */
export function sanitizeSnapshot<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const clone = { ...(value as Record<string, unknown>) };
  if (Array.isArray(clone.attachments)) {
    clone.attachments = (clone.attachments as Record<string, unknown>[]).map(attachment => ({
      name: attachment?.name, size: attachment?.size, type: attachment?.type,
    }));
  }
  return clone as T;
}

export interface LogPayload {
  entityId?: string | number;
  before?: unknown;
  after?: unknown;
  trashId?: number | string;
  revertOf?: string;
}

/**
 * Append an entry, coalescing rapid repeats of the same change.
 *
 * Without the dedupe window, dragging a slider or typing in a title field would
 * bury everything else under dozens of near-identical entries.
 */
export async function addLog(
  action: LogAction,
  entity: LogEntity,
  title = '',
  payload: LogPayload = {},
): Promise<string | null> {
  if (suppressDepth > 0) return null;
  const logs = await load();
  const now = Date.now();
  const last = logs[0];
  if (
    last && last.sessionId === SESSION_ID && last.action === action &&
    last.entity === entity && last.title === title && !last.reverted &&
    now - new Date(last.ts).getTime() < DEDUPE_WINDOW_MS
  ) {
    last.ts = new Date(now).toISOString();
    if (payload.after !== undefined) last.after = sanitizeSnapshot(payload.after);
    await save(logs);
    return last.id;
  }
  const entry: LogEntry = {
    id: Crypto.randomUUID(),
    ts: new Date(now).toISOString(),
    sessionId: SESSION_ID,
    sessionStart: SESSION_START,
    action,
    entity,
    title,
    ...(payload.entityId !== undefined ? { entityId: payload.entityId } : {}),
    ...(payload.before !== undefined ? { before: sanitizeSnapshot(payload.before) } : {}),
    ...(payload.after !== undefined ? { after: sanitizeSnapshot(payload.after) } : {}),
    ...(payload.trashId ? { trashId: payload.trashId } : {}),
    ...(payload.revertOf ? { revertOf: payload.revertOf } : {}),
  };
  await save([entry, ...logs]);
  return entry.id;
}

export async function getLogs(): Promise<LogEntry[]> {
  return load();
}

export async function clearLogs(): Promise<void> {
  await save([]);
}

export async function deleteLogs(ids: string[]): Promise<void> {
  const selected = new Set(ids);
  await save((await load()).filter(log => !selected.has(log.id)));
}

export async function markReverted(id: string): Promise<void> {
  const logs = await load();
  const entry = logs.find(log => log.id === id);
  if (entry) {
    entry.reverted = true;
    entry.revertedAt = new Date().toISOString();
    await save(logs);
  }
}
