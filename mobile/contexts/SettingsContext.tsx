import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Settings } from '@/types';
import { getItem, onStorageScopeChange, setItem } from '@/api/storage';
import { DEFAULT_DAILY_TASK_LIMIT } from '@/utils/schedule';
import { syncWidget } from '@/api/widgets';
import { decisionFlagFor, hydrateSettings } from '@/utils/settingsHydration';

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
  widgetShowTitles: true,
  autoBalance: false,
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
        const { settings: hydrated, migrated } = hydrateSettings(DEFAULTS, stored);
        setSettings(hydrated);
        setLoaded(true);
        // Persist the migrated value and republish the widgets with it, or
        // they keep showing "Task" and "Reminder" until something else writes.
        if (migrated) setItem('nw_settings', hydrated).then(() => syncWidget()).catch(() => {});
      });
    };
    load();
    const unsubscribe = onStorageScopeChange(load);
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      // A choice made here is one the migration must never overturn.
      const decided = decisionFlagFor(key);
      if (decided) next[decided] = true;
      setItem('nw_settings', next).then(() => {
        if (key === 'widgetShowTitles') return syncWidget();
      }).catch(() => {});
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULTS });
    setItem('nw_settings', DEFAULTS).then(() => syncWidget()).catch(() => {});
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
