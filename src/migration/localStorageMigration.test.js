import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../api/client', () => ({
  apiFetch,
  idempotencyKey: () => 'legacy-migration-fixed',
}))

import {
  hasLegacyPlannerData, legacyDataSummary, legacyItems, migrateLegacyPlannerData,
} from './localStorageMigration'

describe('legacy localStorage migration', () => {
  beforeEach(() => {
    localStorage.clear()
    apiFetch.mockReset()
  })

  it('summarizes only planner record stores', () => {
    localStorage.setItem('nw_tasks', JSON.stringify([{ id: 1 }, { id: 2 }]))
    localStorage.setItem('unrelated', JSON.stringify([{ id: 3 }]))
    expect(legacyDataSummary()).toEqual({ nw_tasks: 2, nw_reminders: 0, nw_notes: 0 })
    expect(hasLegacyPlannerData()).toBe(true)
  })

  it('ignores damaged stores instead of counting them', () => {
    localStorage.setItem('nw_tasks', '{"not":"a list"}')
    localStorage.setItem('nw_notes', JSON.stringify([null, 'text', { id: 1, title: 'ok' }]))
    expect(legacyDataSummary()).toEqual({ nw_tasks: 0, nw_reminders: 0, nw_notes: 1 })
  })

  it('uses one stable migration id and removes plaintext only after success', async () => {
    localStorage.setItem('nw_tasks', JSON.stringify([{
      id: 7, title: 'Legacy task', dueDate: '2026-08-20', priority: 'high',
    }]))
    apiFetch.mockResolvedValue({ imported: 1, skipped: 0, record_ids: ['legacy_1'] })
    await migrateLegacyPlannerData('alice')
    expect(apiFetch).toHaveBeenCalledWith('/v1/migrations/local-storage', expect.objectContaining({
      method: 'POST',
    }))
    const body = JSON.parse(apiFetch.mock.calls[0][1].body)
    expect(body.migration_id).toBe('legacy-migration-fixed')
    expect(body.items[0].approved_for_ai).toBe(false)
    expect(localStorage.getItem('nw_tasks')).toBeNull()
  })

  it('keeps the plaintext when the server refuses', async () => {
    localStorage.setItem('nw_tasks', JSON.stringify([{ id: 7, title: 'Legacy task' }]))
    apiFetch.mockRejectedValue(new Error('nope'))
    await expect(migrateLegacyPlannerData('alice')).rejects.toThrow('nope')
    expect(localStorage.getItem('nw_tasks')).not.toBeNull()
  })

  it('coerces what the old planner stored into what the server accepts', () => {
    // Every value here is one the old, unvalidated forms could produce and
    // the strict server would refuse, which used to fail the whole batch.
    localStorage.setItem('nw_tasks', JSON.stringify([{
      id: 1, title: '   ', dueDate: '2026-9-5', dueTime: '9:05', priority: 'High',
      estimatedMinutes: 0, category: '', notes: null,
    }]))
    localStorage.setItem('nw_reminders', JSON.stringify([{
      id: 'r1', title: 'Advisor', date: 'tomorrow', time: '25:00',
    }]))
    localStorage.setItem('nw_notes', JSON.stringify([{
      title: 'BST', body: 'text', tagIds: [2, 'has space', '-lead'],
    }]))

    const [task, reminder, note] = legacyItems()

    expect(task.content).toEqual({
      entity_type: 'task', title: 'Untitled task', due_date: null, due_time: '09:05',
      priority: 'high', category: 'Other', notes: '', completed: false, estimated_minutes: 5,
    })
    expect(reminder.legacy_id).toBe('r1')
    expect(reminder.content.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(reminder.content.time).toBeNull()
    expect(note.legacy_id).toBe(0)
    expect(note.content.tag_ids).toEqual(['2'])
  })
})
