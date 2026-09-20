import type { Settings } from '@/types';

/**
 * Settings whose default changed after people had already stored the old one.
 *
 * Settings are written back as a whole object, so anyone who ever changed any
 * setting has the old default on disk whether or not they meant it. Each entry
 * names the setting and the flag that records a choice the student made
 * themselves; without that flag a stored value equal to the old default is
 * read as the old default and replaced with the current one.
 */
export const MIGRATED_DEFAULTS: ReadonlyArray<{
  key: 'widgetShowTitles' | 'autoBalance';
  decided: 'widgetTitlesDecided' | 'autoBalanceDecided';
}> = [
  // Widget titles were opt-in; a planner widget that only says "Task" is no
  // planner widget, so they are now opt-out.
  { key: 'widgetShowTitles', decided: 'widgetTitlesDecided' },
  // Auto-balance moved tasks around without being asked; it is now opt-in.
  { key: 'autoBalance', decided: 'autoBalanceDecided' },
];

/**
 * Merge stored settings over the defaults, applying the migrations above.
 * Returns whether anything was changed so the caller knows to persist it.
 */
export function hydrateSettings(
  defaults: Settings,
  stored: Partial<Settings> | null | undefined,
): { settings: Settings; migrated: boolean } {
  const merged: Settings = { ...defaults, ...(stored || {}) };
  let migrated = false;
  for (const { key, decided } of MIGRATED_DEFAULTS) {
    if (!merged[decided] && merged[key] !== defaults[key]) {
      merged[key] = defaults[key];
      migrated = true;
    }
  }
  return { settings: merged, migrated };
}

/** The decision flag for a setting, if changing it is a choice worth remembering. */
export function decisionFlagFor(key: keyof Settings): 'widgetTitlesDecided' | 'autoBalanceDecided' | null {
  return MIGRATED_DEFAULTS.find(rule => rule.key === key)?.decided ?? null;
}
