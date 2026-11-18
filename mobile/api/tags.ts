import * as Crypto from 'expo-crypto';
import { Note, PlannerRecordId, Tag } from '@/types';
import { addLog } from './logs';
import { apiConfigured, apiRequest } from './client';
import { getItem, getStorageUid, setItem, updateItem } from './storage';

const LEGACY = 'nw_tags';
const CATALOG = 'nw_shared_tags';
const DEFAULT_TAGS: Tag[] = [
  { id: 'chemistry', name: 'Chemistry', color: '#DBEAFE' },
  { id: 'cs', name: 'CS', color: '#DCFCE7' },
  { id: 'history', name: 'History', color: '#FEF3C7' },
  { id: 'study-tips', name: 'Study Tips', color: '#F3E8FF' },
];

function tagPath(id: PlannerRecordId) {
  return `/v1/tags/${encodeURIComponent(id)}`;
}

function putTag({ id, name, color }: Tag, importOnly = false) {
  return apiRequest<void>(tagPath(id) + (importOnly ? '?import_only=true' : ''), {
    method: 'PUT', body: JSON.stringify({ name, color }),
  });
}

function assertScope(uid: string | null) {
  if (getStorageUid() !== uid) throw new Error('Account changed.');
}

export async function getTags(): Promise<Tag[]> {
  const uid = getStorageUid();
  const stored = await getItem<Tag[] | null>(LEGACY, null);
  const notes = stored ? [] : await getItem<Note[]>('nw_notes', []);
  const oldIds = new Set(notes.flatMap(note => note.tagIds).map(String));
  const legacy = stored ?? DEFAULT_TAGS.map((tag, index) => (
    oldIds.has(String(index + 1)) ? { ...tag, id: index + 1 } : tag
  ));
  assertScope(uid);
  if (!apiConfigured()) return legacy;
  const cached = await getItem<Tag[] | null>(CATALOG, null);
  try {
    if (cached === null) {
      for (const tag of legacy) {
        assertScope(uid);
        await putTag(tag, true);
      }
    }
    assertScope(uid);
    const tags = await apiRequest<Tag[]>('/v1/tags');
    assertScope(uid);
    await setItem(CATALOG, tags);
    return tags;
  } catch {
    assertScope(uid);
    return cached ?? legacy;
  }
}

function mutateTags(updater: (tags: Tag[]) => Tag[] | undefined) {
  return updateItem(apiConfigured() ? CATALOG : LEGACY, DEFAULT_TAGS, updater);
}

export async function createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
  const created = { ...tag, id: `tag_${Crypto.randomUUID()}` };
  await restoreTagDirect(created);
  await addLog('created', 'tag', created.name, { entityId: created.id, after: created });
  return created;
}

export async function updateTag(id: PlannerRecordId, updates: Partial<Tag>): Promise<Tag | undefined> {
  const uid = getStorageUid();
  const before = (await getTags()).find(tag => String(tag.id) === String(id));
  assertScope(uid);
  if (!before) return undefined;
  const tag = { ...before, ...updates, id: before.id };
  if (apiConfigured()) await putTag(tag);
  assertScope(uid);
  await mutateTags(tags => tags.map(item => String(item.id) === String(id) ? tag : item));
  await addLog('updated', 'tag', tag.name, { entityId: id, before, after: tag });
  return tag;
}

export async function deleteTag(id: PlannerRecordId): Promise<void> {
  const uid = getStorageUid();
  const tag = (await getTags()).find(item => String(item.id) === String(id));
  assertScope(uid);
  if (apiConfigured()) await apiRequest<void>(tagPath(id), { method: 'DELETE' });
  assertScope(uid);
  await mutateTags(tags => tags.filter(item => String(item.id) !== String(id)));
  await addLog('deleted', 'tag', tag?.name || '', { entityId: id, before: tag });
}

export async function restoreTagDirect(tag: Tag): Promise<void> {
  const uid = getStorageUid();
  if (apiConfigured()) {
    await getTags();
    assertScope(uid);
    await putTag(tag);
  }
  assertScope(uid);
  await mutateTags(tags => (
    tags.some(item => String(item.id) === String(tag.id)) ? undefined : [...tags, tag]
  ));
}
