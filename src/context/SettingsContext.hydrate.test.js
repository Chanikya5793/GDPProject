import { describe, expect, it } from 'vitest'
import { hydrateSettings } from './SettingsContext'

describe('hydrateSettings', () => {
  it('starts a fresh install with auto-balance off', () => {
    expect(hydrateSettings(null).settings.autoBalance).toBe(false)
  })

  it('turns auto-balance off for an install carrying the old on-by-default it never chose', () => {
    const { settings, migrated } = hydrateSettings({ autoBalance: true })
    expect(settings.autoBalance).toBe(false)
    expect(migrated).toBe(true)
  })

  it('keeps auto-balance on when the student turned it on themselves', () => {
    const { settings, migrated } = hydrateSettings({ autoBalance: true, autoBalanceDecided: true })
    expect(settings.autoBalance).toBe(true)
    expect(migrated).toBe(false)
  })

  it('leaves the rest as stored', () => {
    expect(hydrateSettings({ theme: 'dark', dailyTaskLimit: 3 }).settings).toMatchObject({ theme: 'dark', dailyTaskLimit: 3 })
  })
})
