import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../api/client', () => ({
  apiFetch,
  idempotencyKey: () => 'legacy-migration-fixed',
}))

import {
  hasLegacyPlannerData, legacyDataSummary, migrateLegacyPlannerData,
} from './localStorageMigration'

describe('legacy localStorage migration', () => {
  beforeEach(() => apiFetch.mockReset())

  it('summarizes only planner record stores', () => {
    localStorage.setItem('nw_tasks', JSON.stringify([{ id: 1 }, { id: 2 }]))
    localStorage.setItem('unrelated', JSON.stringify([{ id: 3 }]))
    expect(legacyDataSummary()).toEqual({ nw_tasks: 2, nw_reminders: 0, nw_notes: 0 })
    expect(hasLegacyPlannerData()).toBe(true)
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

})
