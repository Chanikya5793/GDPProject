import { describe, expect, it } from 'vitest';

import {
  Appearance, appearanceFromSettings, COMPACT_SPACE_SCALE, FONT_SCALES,
  modalAnimation, NEUTRAL_APPEARANCE, scaleStyles,
} from './appearance';
import { Settings } from '@/types';

const baseSettings: Settings = {
  theme: 'system', accentColor: 'green', compactMode: false, fontSize: 'default',
  reducedMotion: false, weekStartsOn: 'sunday', defaultPriority: 'medium',
  defaultCategory: 'Homework', showCompleted: true, reminderDefault: 30,
  dueDateAlerts: true, autoBalance: true, dailyTaskLimit: 2,
};

const big: Appearance = { fontScale: 2, spaceScale: 2, reducedMotion: false };

describe('appearanceFromSettings', () => {
  it('is neutral on the defaults', () => {
    expect(appearanceFromSettings(baseSettings)).toEqual(NEUTRAL_APPEARANCE);
  });

  it('maps each font size step', () => {
    for (const size of ['default', 'large', 'larger'] as const) {
      expect(appearanceFromSettings({ ...baseSettings, fontSize: size }).fontScale)
        .toBe(FONT_SCALES[size]);
    }
  });

  it('tightens spacing for compact mode', () => {
    expect(appearanceFromSettings({ ...baseSettings, compactMode: true }).spaceScale)
      .toBe(COMPACT_SPACE_SCALE);
  });

  it('keeps font size and spacing independent', () => {
    // Web's paddings are px and do not grow with the font; neither do these.
    const larger = appearanceFromSettings({ ...baseSettings, fontSize: 'larger' });
    expect(larger.spaceScale).toBe(1);
    const compact = appearanceFromSettings({ ...baseSettings, compactMode: true });
    expect(compact.fontScale).toBe(1);
  });

  it('combines both when both are set', () => {
    const both = appearanceFromSettings({ ...baseSettings, fontSize: 'large', compactMode: true });
    expect(both).toEqual({
      fontScale: FONT_SCALES.large,
      spaceScale: COMPACT_SPACE_SCALE,
      reducedMotion: false,
    });
  });

  it('carries reduced motion through', () => {
    expect(appearanceFromSettings({ ...baseSettings, reducedMotion: true }).reducedMotion).toBe(true);
  });
});

describe('scaleStyles', () => {
  it('scales type', () => {
    expect(scaleStyles({ a: { fontSize: 15, lineHeight: 20 } }, big))
      .toEqual({ a: { fontSize: 30, lineHeight: 40 } });
  });

  it('scales every spacing property', () => {
    const styles = {
      a: {
        padding: 4, paddingTop: 4, paddingBottom: 4, paddingLeft: 4, paddingRight: 4,
        paddingHorizontal: 4, paddingVertical: 4,
        margin: 4, marginTop: 4, marginBottom: 4, marginLeft: 4, marginRight: 4,
        marginHorizontal: 4, marginVertical: 4,
        gap: 4, rowGap: 4, columnGap: 4,
      },
    };
    for (const value of Object.values(scaleStyles(styles, big).a)) {
      expect(value).toBe(8);
    }
  });

  it('leaves sizes alone', () => {
    // Scaling a fixed size would deform anything round — avatars, day circles,
    // the attachment remove badge — and compact mode on web does not touch them.
    const styles = { a: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, flex: 1 } };
    expect(scaleStyles(styles, big)).toEqual(styles);
  });

  it('leaves colours and other non-numeric values alone', () => {
    const styles = { a: { color: '#FFF', fontWeight: '700', position: 'absolute' } };
    expect(scaleStyles(styles, big)).toEqual(styles);
  });

  it('passes percentage and auto values through untouched', () => {
    // '14.28%' times two is not a length; multiplying the string is nonsense.
    const styles = { a: { width: '14.28%', paddingHorizontal: '5%', marginLeft: 'auto' } };
    expect(scaleStyles(styles, big)).toEqual(styles);
  });

  it('rounds to a half point so adjacent cells do not seam', () => {
    expect(scaleStyles({ a: { padding: 7 } }, { ...NEUTRAL_APPEARANCE, spaceScale: 0.75 }).a)
      .toEqual({ padding: 5.5 });
    expect(scaleStyles({ a: { fontSize: 13 } }, { ...NEUTRAL_APPEARANCE, fontScale: 1.125 }).a)
      .toEqual({ fontSize: 14.5 });
  });

  it('returns the sheet untouched when the appearance is neutral', () => {
    const styles = { a: { fontSize: 15, padding: 8 } };
    expect(scaleStyles(styles, NEUTRAL_APPEARANCE)).toBe(styles);
  });

  it('does not mutate the sheet it was given', () => {
    const styles = { a: { fontSize: 15, padding: 8 } };
    scaleStyles(styles, big);
    expect(styles.a).toEqual({ fontSize: 15, padding: 8 });
  });

  it('scales every rule in the sheet, not just the first', () => {
    const scaled = scaleStyles({ a: { padding: 2 }, b: { padding: 3 } }, big);
    expect(scaled).toEqual({ a: { padding: 4 }, b: { padding: 6 } });
  });

  it('survives a null or non-object rule', () => {
    const styles = { a: null, b: { padding: 2 } } as unknown as Record<string, unknown>;
    expect(scaleStyles(styles, big)).toEqual({ a: null, b: { padding: 4 } });
  });
});

describe('modalAnimation', () => {
  it('keeps the preferred animation normally', () => {
    expect(modalAnimation(false, 'slide')).toBe('slide');
    expect(modalAnimation(false, 'fade')).toBe('fade');
  });

  it('cuts straight in under reduced motion', () => {
    expect(modalAnimation(true, 'slide')).toBe('none');
    expect(modalAnimation(true, 'fade')).toBe('none');
  });
});
