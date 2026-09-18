import { TrashItem } from '@/types';
import * as Crypto from 'expo-crypto';

import { getItem, setItem } from './storage';

const KEY = 'nw_trash';

export async function addToTrash(item: object, type: string): Promise<string> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  // Was Date.now(), which collides when two items are deleted in the same
  // millisecond — a bulk delete could then restore the wrong record. The id also
  // has to be returned so the activity log can point a rollback at this entry.
  const trashId = `${type}_${(item as { id?: unknown }).id}_${Crypto.randomUUID()}`;
  const trashItem: TrashItem = {
    ...item,
    _trashId: trashId,
    _trashType: type as TrashItem['_trashType'],
    _deletedAt: new Date().toISOString(),
  };
  await setItem(KEY, [trashItem, ...trash]);
  return trashId;
}

export async function getTrash(userId: string): Promise<TrashItem[]> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  return trash.filter(t => (t as Record<string, unknown>).userId === userId);
}

export type RestoredItem = { item: Record<string, unknown>; type: string };

/**
 * Take an item out of the bin.
 *
 * `restore(item, type)` runs first and the row is removed only once it has
 * succeeded. The row used to go first, so a failed re-create -- the record
 * still existed on the server, the network dropped -- left the item nowhere.
 */
export async function restoreFromTrash(
  trashId: string,
  restore?: (item: Record<string, unknown>, type: string) => Promise<unknown>,
): Promise<RestoredItem | null> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  const item = trash.find(t => t._trashId === trashId);
  if (!item) return null;
  const { _trashId, _trashType, _deletedAt, ...original } = item;
  const result = { item: original as Record<string, unknown>, type: _trashType };
  if (restore) await restore(result.item, result.type);
  const current = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, current.filter(t => t._trashId !== trashId));
  return result;
}

export async function permanentDelete(trashId: string): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => t._trashId !== trashId));
}

export async function emptyTrash(userId: string): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => (t as Record<string, unknown>).userId !== userId));
}
