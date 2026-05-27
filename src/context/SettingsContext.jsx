import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const SettingsContext = createContext()

const DEFAULTS = {
  theme: 'light',
  accentColor: 'green',
  compactMode: false,
  fontSize: 'default',
  reducedMotion: false,
  weekStartsOn: 'sunday',
  defaultPriority: 'medium',
  defaultCategory: 'Homework',
  showCompleted: true,
  reminderDefault: 30,
  dueDateAlerts: true,
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('nw_settings')
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
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

    // Reduced motion
    if (settings.reducedMotion) {
      root.setAttribute('data-reduced-motion', 'true')
    } else {
      root.removeAttribute('data-reduced-motion')
    }
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
