// Font size, compact mode, and reduced motion.
//
// Web applies these by setting data-font-size / data-compact /
// data-reduced-motion on <html> and letting CSS cascade (see the SETTINGS
// blocks at the end of src/index.css). React Native has no cascade and every
// screen hardcodes its own numbers, so the same three settings are applied by
// scaling each style sheet as it is built: fonts by one factor, the spacing
// around them by another.
//
// Only padding, margin and gap are scaled, never width or height. Compact mode
// on web tightens spacing and leaves component sizes alone, and scaling a fixed
// width would deform anything round — avatars, day circles, remove badges.
//
// No react-native import here on purpose: this runs under vitest in plain node.
// The StyleSheet.create wrapper lives next door in createStyles.ts.

import { Settings } from '@/types';

export interface Appearance {
  /** Multiplies fontSize and lineHeight. */
  fontScale: number;
  /** Multiplies padding, margin and gap. */
  spaceScale: number;
  /** True when animations should be skipped. */
  reducedMotion: boolean;
}

/** Web steps the body from 16px to 18px to 20px; these are the same ratios. */
export const FONT_SCALES: Record<Settings['fontSize'], number> = {
  default: 1,
  large: 1.125,
  larger: 1.25,
};

/** Compact mode pulls the padding in without touching type size. */
export const COMPACT_SPACE_SCALE = 0.75;

export const NEUTRAL_APPEARANCE: Appearance = {
  fontScale: 1,
  spaceScale: 1,
  reducedMotion: false,
};

export function appearanceFromSettings(settings: Settings): Appearance {
  return {
    fontScale: FONT_SCALES[settings.fontSize] ?? 1,
    // Spacing tracks compact mode only. Web's paddings are in px and so do not
    // grow with the font either; the two settings stay independent.
    spaceScale: settings.compactMode ? COMPACT_SPACE_SCALE : 1,
    reducedMotion: settings.reducedMotion,
  };
}

const FONT_KEYS = ['fontSize', 'lineHeight'] as const;

const SPACE_KEYS = [
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingHorizontal', 'paddingVertical',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical',
  'gap', 'rowGap', 'columnGap',
] as const;

const FONT_SET = new Set<string>(FONT_KEYS);
const SPACE_SET = new Set<string>(SPACE_KEYS);

/** Round to a half point: sub-pixel padding gives seams between adjacent cells. */
function round(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Scale one style rule. Percentage and 'auto' values pass through untouched —
 * they are already relative, and multiplying the string would produce garbage.
 */
function scaleRule(rule: Record<string, unknown>, appearance: Appearance): Record<string, unknown> {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (FONT_SET.has(key)) {
        next[key] = round(value * appearance.fontScale);
        changed = changed || next[key] !== value;
        continue;
      }
      if (SPACE_SET.has(key)) {
        next[key] = round(value * appearance.spaceScale);
        changed = changed || next[key] !== value;
        continue;
      }
    }
    next[key] = value;
  }
  return changed ? next : rule;
}

/** Apply an appearance to a whole style sheet, before StyleSheet.create registers it. */
export function scaleStyles<T extends Record<string, unknown>>(
  styles: T,
  appearance: Appearance,
): T {
  if (appearance.fontScale === 1 && appearance.spaceScale === 1) return styles;
  const next: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(styles)) {
    next[name] = rule && typeof rule === 'object' && !Array.isArray(rule)
      ? scaleRule(rule as Record<string, unknown>, appearance)
      : rule;
  }
  return next as T;
}

/** Modals slide or fade normally; reduced motion cuts them in. */
export function modalAnimation(
  reducedMotion: boolean,
  preferred: 'slide' | 'fade',
): 'slide' | 'fade' | 'none' {
  return reducedMotion ? 'none' : preferred;
}
