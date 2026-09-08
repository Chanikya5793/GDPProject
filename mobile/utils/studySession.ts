// A focus session: what it is, and what the Lock Screen may say about it.
//
// Pure and clock-free, like utils/widgetSnapshot.ts, and for a sharper reason.
// A Live Activity's content is not stored in the App Group — it lives inside
// ActivityKit and the whole props object is resent on every update, against a
// documented 4KB ceiling. So what goes in has to be small and decided
// somewhere testable, not assembled inline at the call site.
//
// The privacy shape is the same as the widgets, one notch tighter. A Live
// Activity renders on the Lock Screen and in the Dynamic Island, and on iOS 18
// it is mirrored to a paired Apple Watch whether or not anyone asked — the
// library applies that unconditionally and there is no way to opt out. So the
// default headline is the category ("Chemistry"), never what the work is
// called, and the title appears only when Settings already allowed titles.

export const MIN_SESSION_MINUTES = 5;

/**
 * iOS ends a Live Activity after eight hours whatever the app wants, so there
 * is no point offering longer: the countdown would outlive the thing drawing
 * it.
 */
export const MAX_SESSION_MINUTES = 480;

/** Offered as one-tap lengths. Twenty-five is a pomodoro. */
export const SESSION_PRESETS = [15, 25, 45, 60, 90] as const;

export const MAX_LABEL_LENGTH = 34;

export interface StudySessionProps {
  /** Epoch ms. The countdown's lower bound. */
  startedAt: number;
  /** Epoch ms. The countdown's upper bound, and the activity's stale date. */
  endsAt: number;
  /** Epoch ms of a pause, or 0. SwiftUI freezes the timer at this instant. */
  pausedAt: number;
  /** What the student is working on. Empty unless titles are allowed. */
  label: string;
  /** Mirrors the widget titles setting, so the layout can decide for itself. */
  titlesAllowed: boolean;
  /** Shown instead of the label by default. A category is not a secret. */
  category: string;
  /** One number of context, so the card is worth a glance. */
  dueToday: number;
}

export interface SessionInput {
  minutes: number;
  label?: string;
  category?: string;
  titlesAllowed: boolean;
  dueToday: number;
  /** Epoch ms. */
  now: number;
}

function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_SESSION_MINUTES;
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, Math.round(minutes)));
}

function trim(value: string): string {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_LABEL_LENGTH
    ? `${cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

/** The content a session starts with. */
export function buildSessionProps(input: SessionInput): StudySessionProps {
  const minutes = clampMinutes(input.minutes);
  return {
    startedAt: input.now,
    endsAt: input.now + minutes * 60_000,
    pausedAt: 0,
    // Withheld here rather than in the layout, so a title the student did not
    // allow never reaches ActivityKit at all.
    label: input.titlesAllowed ? trim(input.label || '') : '',
    titlesAllowed: input.titlesAllowed,
    category: trim(input.category || 'Focus'),
    dueToday: Math.max(0, Math.round(input.dueToday) || 0),
  };
}

/** Freezing the countdown where it stands. */
export function pauseSession(props: StudySessionProps, now: number): StudySessionProps {
  return props.pausedAt > 0 ? props : { ...props, pausedAt: now };
}

/**
 * Picking the countdown back up.
 *
 * The end moves out by however long the pause lasted, which is what makes a
 * paused session mean "twenty minutes left, whenever you come back" rather than
 * "twenty minutes left, but only if you come back now".
 */
export function resumeSession(props: StudySessionProps, now: number): StudySessionProps {
  if (props.pausedAt <= 0) return props;
  const paused = Math.max(0, now - props.pausedAt);
  return { ...props, pausedAt: 0, endsAt: props.endsAt + paused };
}

/** Adding time without restarting, capped at what iOS will keep alive. */
export function extendSession(
  props: StudySessionProps, minutes: number, now: number,
): StudySessionProps {
  const ceiling = props.startedAt + MAX_SESSION_MINUTES * 60_000;
  const extended = props.endsAt + clampMinutes(minutes) * 60_000;
  return { ...props, endsAt: Math.min(ceiling, Math.max(now, extended)) };
}

/** Whether the countdown has run out. */
export function isFinished(props: StudySessionProps, now: number): boolean {
  return props.pausedAt <= 0 && now >= props.endsAt;
}

/** Whole minutes left, for the in-app control rather than the Lock Screen. */
export function minutesLeft(props: StudySessionProps, now: number): number {
  const at = props.pausedAt > 0 ? props.pausedAt : now;
  return Math.max(0, Math.ceil((props.endsAt - at) / 60_000));
}

/** `24:05`, for the button that ends the session. */
export function formatRemaining(props: StudySessionProps, now: number): string {
  const at = props.pausedAt > 0 ? props.pausedAt : now;
  const seconds = Math.max(0, Math.round((props.endsAt - at) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
