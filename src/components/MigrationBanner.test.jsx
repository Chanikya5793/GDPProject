import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { auth, migrate } = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' }, configured: true },
  migrate: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../migration/localStorageMigration', async importOriginal => ({
  ...(await importOriginal()),
  migrateLegacyPlannerData: migrate,
}))

import MigrationBanner from './MigrationBanner'

describe('MigrationBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    migrate.mockReset()
    auth.user = { uid: 'alice' }
    auth.configured = true
    localStorage.setItem('nw_tasks', JSON.stringify([{ id: 1, title: 'Old task' }]))
  })

  it('offers to move old records when signed in to a configured planner', () => {
    render(<MigrationBanner />)
    expect(screen.getByText(/1 local records/)).toBeInTheDocument()
  })

  it('stays hidden in demo mode, where there is nothing to move into', () => {
    auth.configured = false
    render(<MigrationBanner />)
    expect(screen.queryByText(/Secure your existing/)).toBeNull()
  })

  it('shows the server reason when the move fails, and leaves the offer up', async () => {
    migrate.mockRejectedValue(new Error('items.content.note.title: String should have at least 1 character'))
    render(<MigrationBanner />)
    fireEvent.click(screen.getByText('Migrate now'))
    await waitFor(() => expect(screen.getByText(/at least 1 character/)).toBeInTheDocument())
    expect(screen.getByText('Migrate now')).not.toBeDisabled()
  })

  it('reports what moved when it works', async () => {
    migrate.mockResolvedValue({ imported: 3, skipped: 1, rejected: [{ reason: 'x' }] })
    render(<MigrationBanner />)
    fireEvent.click(screen.getByText('Migrate now'))
    await waitFor(() => expect(screen.getByText(/3 moved, 1 already there, 1 could not be read/)).toBeInTheDocument())
  })

  it('can be put off for the session', () => {
    render(<MigrationBanner />)
    fireEvent.click(screen.getByText('Not now'))
    expect(screen.queryByText(/Secure your existing/)).toBeNull()
    expect(sessionStorage.getItem('nw_migration_dismissed')).toBe('1')
  })
})
