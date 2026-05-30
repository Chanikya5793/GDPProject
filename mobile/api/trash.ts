import { TrashItem } from '@/types';
import { getItem, setItem } from './storage';

const KEY = 'nw_trash';

export async function addToTrash(item: object, type: string): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  const trashItem: TrashItem = {
    ...item,
    _trashId: Date.now(),
    _trashType: type as TrashItem['_trashType'],
    _deletedAt: new Date().toISOString(),
  };
  await setItem(KEY, [...trash, trashItem]);
}

export async function getTrash(userId: number): Promise<TrashItem[]> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  return trash.filter(t => (t as Record<string, unknown>).userId === userId);
}

export async function restoreFromTrash(trashId: number): Promise<{ item: Record<string, unknown>; type: string } | null> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  const item = trash.find(t => t._trashId === trashId);
  if (!item) return null;
  await setItem(KEY, trash.filter(t => t._trashId !== trashId));
  const { _trashId, _trashType, _deletedAt, ...original } = item;
  return { item: original as Record<string, unknown>, type: _trashType };
}

export async function permanentDelete(trashId: number): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => t._trashId !== trashId));
}

export async function emptyTrash(userId: number): Promise<void> {
  const trash = await getItem<TrashItem[]>(KEY, []);
  await setItem(KEY, trash.filter(t => (t as Record<string, unknown>).userId !== userId));
}
