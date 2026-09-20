import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone edits a note the web created. Whatever it does not understand --
// the web's text attachments and string tag ids -- has to come back out
// exactly as it went in, or a phone edit erases it on the server.

const server = vi.hoisted(() => ({
  records: new Map<string, { record_id: string; revision: number; approved_for_ai: boolean; created_at: string; updated_at: string; content: Record<string, unknown> }>(),
  puts: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'u1' } }, firebaseConfigured: true }));

vi.mock('@/api/storage', () => {
  const store = new Map<string, unknown>();
  return {
    getItem: async <T,>(key: string, fallback: T) => (store.has(key) ? store.get(key) as T : fallback),
    setItem: async (key: string, value: unknown) => { store.set(key, value); },
    getStorageUid: () => 'u1',
    setStorageUid: () => {},
  };
});

vi.mock('@/api/client', () => ({
  apiRequest: async (path: string, options: { method?: string; body?: string } = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/v1/index/')) return { status: 'indexed' };
    const id = path.split('/')[4];
    if (method === 'GET') return [...server.records.values()];
    const body = JSON.parse(options.body || '{}') as { content: Record<string, unknown>; approved_for_ai: boolean };
    server.puts.push(body.content);
    const current = server.records.get(id);
    const record = {
      record_id: id, revision: (current?.revision || 0) + 1, approved_for_ai: body.approved_for_ai,
      created_at: '2026-09-17T00:00:00Z', updated_at: '2026-09-17T00:00:00Z', content: body.content,
    };
    server.records.set(id, record);
    return record;
  },
  idempotencyKey: (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`,
}));

import { listPlannerItems, updatePlannerItem } from '@/api/plannerClient';
import { Note } from '@/types';

describe('a note the web created, edited on the phone', () => {
  beforeEach(() => {
    server.records.clear();
    server.puts.length = 0;
    server.records.set('web-note', {
      record_id: 'web-note', revision: 3, approved_for_ai: true,
      created_at: '2026-09-17T00:00:00Z', updated_at: '2026-09-17T00:00:00Z',
      content: {
        entity_type: 'note', title: 'Syllabus', body: 'Week one',
        tag_ids: ['chemistry', '7'],
        attachments: [{ attachment_id: 'a1', filename: 'syllabus.txt', text: 'Exam on the 30th', approved_for_ai: true }],
      },
    });
  });

  it('keeps the web tag ids instead of turning them into NaN', async () => {
    const [note] = await listPlannerItems<Note>('note');
    expect(note.tagIds).toEqual([7]);
    expect(note._foreignTagIds).toEqual(['chemistry']);
    expect(note.tagIds.some(Number.isNaN)).toBe(false);
  });

  it('sends the web text attachments and tag ids back untouched on save', async () => {
    await listPlannerItems<Note>('note');
    await updatePlannerItem<Note>('note', 'web-note', { body: 'Week one, edited on the phone' });
    const sent = server.puts.at(-1)!;
    expect(sent.body).toBe('Week one, edited on the phone');
    expect(sent.tag_ids).toEqual(['7', 'chemistry']);
    expect(sent.attachments).toEqual([
      { attachment_id: 'a1', filename: 'syllabus.txt', text: 'Exam on the 30th', approved_for_ai: true },
    ]);
  });

  it('still lets the phone change its own tags', async () => {
    await listPlannerItems<Note>('note');
    await updatePlannerItem<Note>('note', 'web-note', { tagIds: [7, 12] });
    expect(server.puts.at(-1)!.tag_ids).toEqual(['7', '12', 'chemistry']);
  });
});
