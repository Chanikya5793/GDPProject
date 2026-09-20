import { describe, expect, it } from 'vitest';
import type { Settings } from '@/types';
import { hydrateSettings } from './settingsHydration';

const defaults = {
  theme: 'system', accentColor: 'green', compactMode: false, fontSize: 'default',
  reducedMotion: false, weekStartsOn: 'sunday', defaultPriority: 'medium',
  defaultCategory: 'Homework', showCompleted: true, reminderDefault: 30,
  dueDateAlerts: true, widgetShowTitles: true, autoBalance: true, dailyTaskLimit: 6,
} as Settings;

describe('hydrateSettings', () => {
  it('starts a fresh install with titles on', () => {
    const { settings, migrated } = hydrateSettings(defaults, null);
    expect(settings.widgetShowTitles).toBe(true);
    expect(migrated).toBe(false);
  });

  it('turns titles on for an install that carried the old default it never chose', () => {
    const { settings, migrated } = hydrateSettings(defaults, { ...defaults, widgetShowTitles: false });
    expect(settings.widgetShowTitles).toBe(true);
    expect(migrated).toBe(true);
  });

  it('respects an off the student set themselves', () => {
    const { settings, migrated } = hydrateSettings(defaults, {
      ...defaults, widgetShowTitles: false, widgetTitlesDecided: true,
    });
    expect(settings.widgetShowTitles).toBe(false);
    expect(migrated).toBe(false);
  });

  it('leaves every other setting as stored', () => {
    const { settings } = hydrateSettings(defaults, { ...defaults, theme: 'dark', dailyTaskLimit: 3 });
    expect(settings.theme).toBe('dark');
    expect(settings.dailyTaskLimit).toBe(3);
  });
});
