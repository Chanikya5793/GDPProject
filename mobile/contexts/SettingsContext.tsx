import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Settings } from '@/types';
import { getItem, onStorageScopeChange, setItem } from '@/api/storage';
import { DEFAULT_DAILY_TASK_LIMIT } from '@/utils/schedule';

const DEFAULTS: Settings = {
  theme: 'system',
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
  autoBalance: true,
  dailyTaskLimit: DEFAULT_DAILY_TASK_LIMIT,
};

interface SettingsContextType {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  DEFAULTS: Settings;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Settings are stored per user, but this provider sits above AuthProvider and
  // so reads once before any uid is known. Re-read whenever the storage scope
  // changes, or the signed-in user's saved settings would never be loaded and
  // every launch would come up on the defaults.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getItem<Settings>('nw_settings', DEFAULTS).then(stored => {
        if (cancelled) return;
        setSettings({ ...DEFAULTS, ...stored });
        setLoaded(true);
      });
    };
    load();
    const unsubscribe = onStorageScopeChange(load);
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      setItem('nw_settings', next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULTS });
    setItem('nw_settings', DEFAULTS);
  }, []);

  if (!loaded) return null;

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, resetSettings, DEFAULTS }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
