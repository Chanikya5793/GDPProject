import { describe, expect, it } from 'vitest';

import {
  allDayItems, dayHeaders, formatHour, formatTime, getNavTitle, getViewDates,
  getWeekDates, itemsInHour, minutesIntoDay, monthCells, shiftDays, stepCursor,
} from './calendarView';

// 2026-08-26 is a Wednesday. Every fixture below is anchored to it.
const WED = '2026-08-26';

describe('shiftDays', () => {
  it('moves forward and backward', () => {
    expect(shiftDays(WED, 1)).toBe('2026-08-27');
    expect(shiftDays(WED, -1)).toBe('2026-08-25');
  });

  it('crosses a month boundary', () => {
    expect(shiftDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('formatTime / formatHour', () => {
  it('renders 12-hour clock times', () => {
    expect(formatTime('00:30')).toBe('12:30 AM');
    expect(formatTime('09:05')).toBe('9:05 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('13:45')).toBe('1:45 PM');
  });

  it('returns an empty string for a missing time', () => {
    expect(formatTime('')).toBe('');
  });

  it('labels the hour rulers', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(23)).toBe('11 PM');
  });
});

describe('dayHeaders', () => {
  it('rotates so the configured start day comes first', () => {
    expect(dayHeaders('sunday')[0]).toBe('Sun');
    expect(dayHeaders('monday')[0]).toBe('Mon');
    expect(dayHeaders('monday')[6]).toBe('Sun');
    expect(dayHeaders('monday')).toHaveLength(7);
  });
});

describe('getWeekDates', () => {
  it('starts on Sunday when configured', () => {
    expect(getWeekDates(WED, 'sunday')).toEqual([
      '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26',
      '2026-08-27', '2026-08-28', '2026-08-29',
    ]);
  });

  it('starts on Monday when configured', () => {
    expect(getWeekDates(WED, 'monday')[0]).toBe('2026-08-24');
  });

  it('does not move the week when the reference day is already the start', () => {
    expect(getWeekDates('2026-08-23', 'sunday')[0]).toBe('2026-08-23');
    // A Sunday under a Monday-start week belongs to the week that just ended.
    expect(getWeekDates('2026-08-23', 'monday')[0]).toBe('2026-08-17');
  });
});

describe('getViewDates', () => {
  it('gives a single day for the day view', () => {
    expect(getViewDates(WED, 'day', 'sunday')).toEqual([WED]);
  });

  it('runs the three-day view forward from the selected day', () => {
    expect(getViewDates(WED, 'threeday', 'sunday'))
      .toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
  });

  it('gives Monday to Friday for the work week', () => {
    expect(getViewDates(WED, 'workweek', 'sunday')).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    ]);
  });

  it('keeps the work week on Mon-Fri regardless of the week-start setting', () => {
    expect(getViewDates(WED, 'workweek', 'monday'))
      .toEqual(getViewDates(WED, 'workweek', 'sunday'));
  });

  it('pulls a weekend day back into the work week that precedes it', () => {
    // Sunday 2026-08-30 belongs to the Mon 24 - Fri 28 block, not the next one.
    expect(getViewDates('2026-08-30', 'workweek', 'sunday')[0]).toBe('2026-08-24');
  });

  it('honours the week-start setting for the week view', () => {
    expect(getViewDates(WED, 'week', 'monday')).toEqual(getWeekDates(WED, 'monday'));
  });

  it('returns nothing for month, which has no fixed span', () => {
    expect(getViewDates(WED, 'month', 'sunday')).toEqual([]);
  });
});

describe('getNavTitle', () => {
  it('names the month for the month view, ignoring the selected date', () => {
    expect(getNavTitle('month', WED, 2026, 7, 'sunday')).toBe('August 2026');
    expect(getNavTitle('month', WED, 2027, 0, 'sunday')).toBe('January 2027');
  });

  it('spells out the day for the day view', () => {
    expect(getNavTitle('day', WED, 2026, 7, 'sunday')).toBe('Wednesday, August 26');
  });

  it('gives a compact range when the span sits inside one month', () => {
    expect(getNavTitle('week', WED, 2026, 7, 'sunday')).toBe('August 23 - 29, 2026');
  });

  it('names both months when the span straddles them', () => {
    // Aug 30 - Sep 5 crosses the boundary, so each end needs its month.
    expect(getNavTitle('week', '2026-09-01', 2026, 8, 'sunday'))
      .toBe('Aug 30 - Sep 5, 2026');
  });
});

describe('stepCursor', () => {
  const cursor = { selectedDate: WED, year: 2026, month: 7 };

  it('steps the month view a month at a time and leaves the date alone', () => {
    expect(stepCursor(cursor, 'month', 1)).toEqual({ ...cursor, month: 8 });
    expect(stepCursor(cursor, 'month', -1)).toEqual({ ...cursor, month: 6 });
  });

  it('rolls the year over at the ends of the month range', () => {
    expect(stepCursor({ selectedDate: WED, year: 2026, month: 11 }, 'month', 1))
      .toMatchObject({ year: 2027, month: 0 });
    expect(stepCursor({ selectedDate: WED, year: 2026, month: 0 }, 'month', -1))
      .toMatchObject({ year: 2025, month: 11 });
  });

  it('steps each time-grid view by its own width', () => {
    expect(stepCursor(cursor, 'day', 1).selectedDate).toBe('2026-08-27');
    expect(stepCursor(cursor, 'threeday', 1).selectedDate).toBe('2026-08-29');
    expect(stepCursor(cursor, 'week', 1).selectedDate).toBe('2026-09-02');
    expect(stepCursor(cursor, 'workweek', -1).selectedDate).toBe('2026-08-19');
  });

  it('keeps year and month in step with the date it moved to', () => {
    // Otherwise the month strip would still read August after paging into
    // September, and jumping back to the month view would land in the past.
    expect(stepCursor(cursor, 'week', 1)).toEqual({
      selectedDate: '2026-09-02', year: 2026, month: 8,
    });
  });
});

describe('monthCells', () => {
  it('fills whole weeks', () => {
    const cells = monthCells(2026, 7, 'sunday');
    expect(cells.length % 7).toBe(0);
  });

  it('spills the leading days in from the previous month', () => {
    // August 2026 starts on a Saturday, so a Sunday-start grid needs Jul 26-31.
    const cells = monthCells(2026, 7, 'sunday');
    expect(cells[0]).toEqual({ date: '2026-07-26', day: 26, inMonth: false });
    expect(cells.find(c => c.date === '2026-08-01')?.inMonth).toBe(true);
  });

  it('spills the trailing days in from the next month', () => {
    const cells = monthCells(2026, 7, 'sunday');
    const last = cells[cells.length - 1];
    expect(last.inMonth).toBe(false);
    expect(last.date.startsWith('2026-09')).toBe(true);
  });

  it('shifts the leading spill when the week starts on Monday', () => {
    expect(monthCells(2026, 7, 'monday')[0].date).toBe('2026-07-27');
  });

  it('holds every day of the month exactly once', () => {
    const inMonth = monthCells(2026, 1, 'sunday').filter(c => c.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(new Set(inMonth.map(c => c.date)).size).toBe(28);
  });

  it('covers a leap February', () => {
    expect(monthCells(2028, 1, 'sunday').filter(c => c.inMonth)).toHaveLength(29);
  });

  it('emits no duplicate dates across the spill boundaries', () => {
    const cells = monthCells(2026, 7, 'sunday');
    expect(new Set(cells.map(c => c.date)).size).toBe(cells.length);
  });
});

describe('allDayItems / itemsInHour', () => {
  const items = [
    { id: 1, dueTime: '09:30' },
    { id: 2, time: '09:00' },
    { id: 3, dueTime: '' },
    { id: 4 },
    { id: 5, dueTime: '14:00' },
  ];

  it('treats a missing or empty time as all-day', () => {
    expect(allDayItems(items).map(i => i.id)).toEqual([3, 4]);
  });

  it('buckets tasks and reminders into the same hour', () => {
    // Tasks carry dueTime and reminders carry time; both belong in hour 9.
    expect(itemsInHour(items, 9).map(i => i.id)).toEqual([1, 2]);
    expect(itemsInHour(items, 14).map(i => i.id)).toEqual([5]);
    expect(itemsInHour(items, 3)).toEqual([]);
  });

  it('keeps all-day items out of every hour', () => {
    const bucketed = Array.from({ length: 24 }, (_, h) => itemsInHour(items, h)).flat();
    expect(bucketed.map(i => i.id).sort()).toEqual([1, 2, 5]);
  });
});

describe('minutesIntoDay', () => {
  it('counts minutes past midnight', () => {
    expect(minutesIntoDay(new Date(2026, 7, 26, 0, 0))).toBe(0);
    expect(minutesIntoDay(new Date(2026, 7, 26, 9, 30))).toBe(570);
    expect(minutesIntoDay(new Date(2026, 7, 26, 23, 59))).toBe(1439);
  });
});
