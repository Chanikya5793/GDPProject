import { describe, expect, it } from 'vitest';
import { recurrenceLabel } from './recurrence';

describe('recurrence labels', () => {
  it('reads plainly at an interval of one', () => {
    expect(recurrenceLabel({ frequency: 'weekly', interval: 1, count: 13 })).toBe('Weekly');
    expect(recurrenceLabel({ frequency: 'daily', interval: 1, count: 5 })).toBe('Daily');
  });

  it('counts the gap when it is more than one', () => {
    expect(recurrenceLabel({ frequency: 'weekly', interval: 2, count: 4 })).toBe('Every 2 weeks');
  });

  it('refuses anything it does not recognise, so no chip is drawn', () => {
    expect(recurrenceLabel(null)).toBeNull();
    expect(recurrenceLabel(undefined)).toBeNull();
    expect(recurrenceLabel({ frequency: 'hourly', interval: 1, count: 2 })).toBeNull();
  });

  it('matches the web wording exactly, so the two clients agree', () => {
    expect(recurrenceLabel({ frequency: 'monthly', interval: 3, count: 4 })).toBe('Every 3 months');
  });
});
