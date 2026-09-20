import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEFAULT_DAILY_TASK_LIMIT } from '../utils/schedule'

const SettingsContext = createContext()

const DEFAULTS = {
  theme: 'light',
  accentColor: 'green',
  compactMode: false,
  fontSize: 'default',
  weekStartsOn: 'sunday',
  defaultPriority: 'medium',
  defaultCategory: 'Homework',
  showCompleted: true,
  reminderDefault: 30,
  dueDateAlerts: true,
  autoBalance: false,
  dailyTaskLimit: DEFAULT_DAILY_TASK_LIMIT,
}

// Settings whose default changed after people had already stored the old
// one. The object is written back whole, so a stored value equal to the old
// default is not evidence of a choice; the flag is. Auto-balance used to be
// on and moved tasks without asking; it is opt-in now.
const MIGRATED_DEFAULTS = [{ key: 'autoBalance', decided: 'autoBalanceDecided' }]

export function hydrateSettings(stored) {
  const merged = { ...DEFAULTS, ...(stored || {}) }
  let migrated = false
  for (const { key, decided } of MIGRATED_DEFAULTS) {
    if (!merged[decided] && merged[key] !== DEFAULTS[key]) {
      merged[key] = DEFAULTS[key]
      migrated = true
    }
  }
  return { settings: merged, migrated }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('nw_settings')
    if (raw) {
      const { settings, migrated } = hydrateSettings(JSON.parse(raw))
      if (migrated) localStorage.setItem('nw_settings', JSON.stringify(settings))
      return settings
    }
  } catch { /* use defaults */ }
  return { ...DEFAULTS }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings)

  /* Apply all visual settings to DOM root */
  useEffect(() => {
    const root = document.documentElement

    // Theme
    let effectiveTheme = settings.theme
    if (effectiveTheme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    root.setAttribute('data-theme', effectiveTheme)

    // Accent color
    root.setAttribute('data-accent', settings.accentColor)

    // Font size
    root.setAttribute('data-font-size', settings.fontSize)

    // Compact mode
    root.setAttribute('data-compact', settings.compactMode ? 'true' : 'false')

  }, [settings])

  /* Listen for system theme changes when theme='system' */
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [settings.theme])

  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      // A choice made here is one the migration must never overturn.
      const rule = MIGRATED_DEFAULTS.find(item => item.key === key)
      if (rule) next[rule.decided] = true
      localStorage.setItem('nw_settings', JSON.stringify(next))
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULTS })
    localStorage.setItem('nw_settings', JSON.stringify(DEFAULTS))
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, resetSettings, DEFAULTS }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
