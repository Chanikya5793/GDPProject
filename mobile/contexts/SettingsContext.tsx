import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Settings } from '@/types';
import { getItem, setItem } from '@/api/storage';

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

  useEffect(() => {
    getItem<Settings>('nw_settings', DEFAULTS).then(stored => {
      setSettings({ ...DEFAULTS, ...stored });
      setLoaded(true);
    });
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
