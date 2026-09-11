import { describe, expect, it } from 'vitest';

import { isTimeInputUsable, parseTimeInput, TIME_PATTERN } from './timeInput';

describe('parseTimeInput', () => {
  it('treats a blank field as no time rather than an error', () => {
    for (const blank of ['', '   ', null, undefined]) {
      expect(parseTimeInput(blank)).toEqual({ value: null, error: null });
    }
  });

  it('accepts a canonical time unchanged', () => {
    expect(parseTimeInput('09:30')).toEqual({ value: '09:30', error: null });
    expect(parseTimeInput('00:00')).toEqual({ value: '00:00', error: null });
    expect(parseTimeInput('23:59')).toEqual({ value: '23:59', error: null });
  });

  it('pads a single-digit hour', () => {
    // "9:30" is what people type, and the API rejects it outright.
    expect(parseTimeInput('9:30').value).toBe('09:30');
  });

  it('accepts a bare digit run and inserts the colon', () => {
    expect(parseTimeInput('930').value).toBe('09:30');
    expect(parseTimeInput('1400').value).toBe('14:00');
  });

  it('ignores surrounding whitespace', () => {
    expect(parseTimeInput('  14:00  ').value).toBe('14:00');
  });

  it('rejects an hour past 23 with a specific message', () => {
    const result = parseTimeInput('25:00');
    expect(result.value).toBeNull();
    expect(result.error).toContain('Hour');
  });

  it('rejects minutes past 59 with a specific message', () => {
    const result = parseTimeInput('12:70');
    expect(result.value).toBeNull();
    expect(result.error).toContain('Minutes');
  });

  it('rejects text and stray punctuation', () => {
    for (const bad of ['abc', '9.30', '9-30', '::', '9:3', '9:300']) {
      expect(parseTimeInput(bad).error).toBeTruthy();
    }
  });

  it('rejects a 12-hour time with a meridiem', () => {
    // Silently reading "9:30 PM" as 09:30 would set the wrong time.
    expect(parseTimeInput('9:30 PM').error).toBeTruthy();
  });

  it('produces only values the API pattern accepts', () => {
    for (const input of ['9:30', '930', '00:00', '23:59', '1400', ' 7:05 ']) {
      const { value } = parseTimeInput(input);
      expect(value).not.toBeNull();
      expect(TIME_PATTERN.test(value as string)).toBe(true);
    }
  });
});

describe('isTimeInputUsable', () => {
  it('is true for blank and for anything parseable', () => {
    expect(isTimeInputUsable('')).toBe(true);
    expect(isTimeInputUsable('9:30')).toBe(true);
  });

  it('is false for input that cannot be read as a time', () => {
    expect(isTimeInputUsable('25:00')).toBe(false);
    expect(isTimeInputUsable('abc')).toBe(false);
  });
});
