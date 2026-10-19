import { describe, expect, it } from 'vitest';

import { escalationBadgeLabel } from './escalationBadge';

describe('escalationBadgeLabel', () => {
  it('calls only a past due date overdue', () => {
    expect(escalationBadgeLabel(-1)).toBe('OVERDUE');
    expect(escalationBadgeLabel(-30)).toBe('OVERDUE');
  });

  it('says today for a task due today, not overdue', () => {
    expect(escalationBadgeLabel(0)).toBe('TODAY');
  });

  it('counts down the days ahead', () => {
    expect(escalationBadgeLabel(1)).toBe('TMR');
    expect(escalationBadgeLabel(3)).toBe('3D');
  });
});
