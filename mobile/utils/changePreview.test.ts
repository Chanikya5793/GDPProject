import { describe, expect, it } from 'vitest';
import { changeLines, changeSummary, spokenDate, spokenTime } from './changePreview';

describe('what a change looks like to a person', () => {
  it('reads a new record as what it adds, not as a JSON object', () => {
    expect(changeLines({
      before: null,
      after: { title: 'Fill Microsoft Form', date: '2026-09-04', time: '13:30' },
    })).toEqual([
      { label: 'Adds', to: 'Fill Microsoft Form' },
      { label: 'When', to: 'Fri 4 Sep at 1:30 PM' },
    ]);
  });

  it('lists only what actually moves on an edit', () => {
    const lines = changeLines({
      before: { title: 'Lab report', due_date: '2026-08-28', priority: 'high' },
      after: { title: 'Lab report', due_date: '2026-09-04', priority: 'high' },
    });
    expect(lines).toEqual([{ label: 'Date', from: 'Fri 28 Aug', to: 'Fri 4 Sep' }]);
  });

  it('matches the web wording exactly, so a change reads the same on both', () => {
    // Separate implementations in separate languages; without this they drift.
    expect(changeSummary({
      before: { title: 'Lab report', due_date: '2026-08-28' },
      after: { title: 'Lab report', due_date: '2026-09-04' },
    })).toBe('Lab report · Date Fri 28 Aug → Fri 4 Sep');
    expect(spokenDate('2026-09-04')).toBe('Fri 4 Sep');
    expect(spokenTime('13:30')).toBe('1:30 PM');
    expect(spokenTime('00:05')).toBe('12:05 AM');
  });

  it('never renders an empty change as a blank card', () => {
    expect(changeLines({ before: { title: 'Same' }, after: { title: 'Same' } })[0].label)
      .toBe('No visible change');
  });
});
