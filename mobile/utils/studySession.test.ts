import { describe, expect, it } from 'vitest';
import {
  buildSessionProps,
  extendSession,
  formatRemaining,
  isFinished,
  MAX_LABEL_LENGTH,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  minutesLeft,
  pauseSession,
  resumeSession,
  StudySessionProps,
} from './studySession';

const NOW = new Date(2026, 8, 8, 14, 0).getTime();

function start(overrides: Partial<Parameters<typeof buildSessionProps>[0]> = {}) {
  return buildSessionProps({
    minutes: 25, label: 'Organic chemistry problem set', category: 'Homework',
    titlesAllowed: false, dueToday: 3, now: NOW, ...overrides,
  });
}

describe('buildSessionProps', () => {
  it('ends the session the requested number of minutes out', () => {
    expect(start().endsAt - NOW).toBe(25 * 60_000);
  });

  it('withholds the label entirely unless titles are allowed', () => {
    expect(start().label).toBe('');
    expect(start({ titlesAllowed: true }).label).toContain('Organic chemistry');
  });

  it('truncates an allowed label rather than letting it fill the island', () => {
    const label = start({
      titlesAllowed: true,
      label: 'Organic chemistry problem set, questions 4 through 11',
    }).label;
    expect(label.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(label.endsWith('…')).toBe(true);
  });

  it('falls back to a category that is safe to show', () => {
    expect(start({ category: '' }).category).toBe('Focus');
    expect(start().category).toBe('Homework');
  });

  it('clamps a length iOS would not keep alive', () => {
    expect(start({ minutes: 1 }).endsAt - NOW).toBe(MIN_SESSION_MINUTES * 60_000);
    expect(start({ minutes: 10_000 }).endsAt - NOW).toBe(MAX_SESSION_MINUTES * 60_000);
    expect(start({ minutes: Number.NaN }).endsAt - NOW).toBe(MIN_SESSION_MINUTES * 60_000);
  });

  it('never carries a negative count', () => {
    expect(start({ dueToday: -4 }).dueToday).toBe(0);
  });
});

describe('pause and resume', () => {
  const props = start();
  const paused = pauseSession(props, NOW + 5 * 60_000);

  it('freezes at the moment of the pause', () => {
    expect(paused.pausedAt).toBe(NOW + 5 * 60_000);
    expect(minutesLeft(paused, NOW + 60 * 60_000)).toBe(20);
  });

  it('does not move the pause when paused twice', () => {
    expect(pauseSession(paused, NOW + 9 * 60_000).pausedAt).toBe(paused.pausedAt);
  });

  it('gives back the time the pause took, rather than the wall clock', () => {
    // Paused at 5 minutes in, resumed an hour later: 20 minutes should remain.
    const resumed = resumeSession(paused, NOW + 65 * 60_000);
    expect(resumed.pausedAt).toBe(0);
    expect(minutesLeft(resumed, NOW + 65 * 60_000)).toBe(20);
  });

  it('leaves a running session alone', () => {
    expect(resumeSession(props, NOW + 60_000)).toBe(props);
  });
});

describe('extendSession', () => {
  it('adds time without restarting', () => {
    const longer = extendSession(start(), 15, NOW + 60_000);
    expect(minutesLeft(longer, NOW)).toBe(40);
  });

  it('will not push past what iOS keeps alive', () => {
    const props = start({ minutes: MAX_SESSION_MINUTES });
    const longer = extendSession(props, 60, NOW);
    expect(longer.endsAt).toBe(props.startedAt + MAX_SESSION_MINUTES * 60_000);
  });

  it('brings a finished session back to at least now', () => {
    const done = { ...start(), endsAt: NOW - 60 * 60_000 } as StudySessionProps;
    expect(extendSession(done, 5, NOW).endsAt).toBeGreaterThanOrEqual(NOW);
  });
});

describe('isFinished', () => {
  it('is true once the countdown runs out', () => {
    const props = start();
    expect(isFinished(props, NOW + 10 * 60_000)).toBe(false);
    expect(isFinished(props, NOW + 25 * 60_000)).toBe(true);
  });

  it('is never true while paused, however long ago that was', () => {
    const paused = pauseSession(start(), NOW + 60_000);
    expect(isFinished(paused, NOW + 5 * 60 * 60_000)).toBe(false);
  });
});

describe('formatRemaining', () => {
  it('reads as a clock', () => {
    expect(formatRemaining(start(), NOW)).toBe('25:00');
    expect(formatRemaining(start(), NOW + 24 * 60_000 + 55_000)).toBe('0:05');
  });

  it('stops at zero rather than counting up', () => {
    expect(formatRemaining(start(), NOW + 40 * 60_000)).toBe('0:00');
  });
});
