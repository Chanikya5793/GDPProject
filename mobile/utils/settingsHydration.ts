import type { Settings } from '@/types';

/**
 * Merge stored settings over the defaults, applying one migration.
 *
 * Widget titles used to be off by default, and settings are written back as
 * a whole object, so anyone who ever changed any setting has
 * `widgetShowTitles: false` on disk whether or not they meant it -- and their
 * widgets said nothing but "Task" and "Reminder". Until the student has set
 * the switch themselves (`widgetTitlesDecided`), the stored value is treated
 * as the old default and replaced with the new one. Returns whether anything
 * was changed so the caller knows to persist and republish.
 */
export function hydrateSettings(
  defaults: Settings,
  stored: Partial<Settings> | null | undefined,
): { settings: Settings; migrated: boolean } {
  const merged: Settings = { ...defaults, ...(stored || {}) };
  if (!merged.widgetTitlesDecided && merged.widgetShowTitles !== defaults.widgetShowTitles) {
    return { settings: { ...merged, widgetShowTitles: defaults.widgetShowTitles }, migrated: true };
  }
  return { settings: merged, migrated: false };
}
