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

export async function restoreFromTrash(trashId: string): Promise<{ item: Record<string, unknown>; type: string } | null> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  const item = trash.find(t => t._trashId === trashId);
  if (!item) return null;
  await setItem(KEY, trash.filter(t => t._trashId !== trashId));
  const { _trashId, _trashType, _deletedAt, ...original } = item;
  return { item: original as Record<string, unknown>, type: _trashType };
}

export async function permanentDelete(trashId: string): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => t._trashId !== trashId));
}

export async function emptyTrash(userId: string): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => (t as Record<string, unknown>).userId !== userId));
}
