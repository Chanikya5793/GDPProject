// The device half of the focus session.
//
// Unlike the widgets, nothing here is written to the App Group: a Live
// Activity's content lives inside ActivityKit and travels through start and
// update. Only the layout is stored, by createLiveActivity at import time —
// which is why widgets/StudySession.tsx has to actually be imported for
// anything to appear, the same trap as the widgets in api/widgets.ts.
//
// What the session survives, and what it does not:
//
//   Closing the app is fine. The countdown is a SwiftUI timer bound to two
//   timestamps, so it keeps ticking correctly with nothing of ours running,
//   and the stale date makes the card go quiet at the session's end by itself.
//
//   Never reopening the app is not fine, and cannot be. iOS ends a Live
//   Activity after eight hours whatever anyone wants; that is the only
//   guaranteed clean-up. So the design has to make that state acceptable
//   rather than avoid it — hence the stale date, which leaves a finished
//   session looking finished rather than looking wrong.

import { after, type LiveActivity } from 'expo-widgets';
import {
  buildSessionProps,
  extendSession,
  pauseSession,
  resumeSession,
  SessionInput,
  StudySessionProps,
} from '@/utils/studySession';
import StudySession from '@/widgets/StudySession';
import { getItem, setItem } from './storage';

/** ActivityKit does not read content back, so the last state is kept here. */
const STATE_KEY = 'nw_focus_session';

let handle: LiveActivity<StudySessionProps> | null = null;

/**
 * Reattach to a session already running.
 *
 * getInstances reads ActivityKit directly rather than anything of ours, so this
 * survives the app being killed and relaunched mid-session.
 */
function attach(): LiveActivity<StudySessionProps> | null {
  try {
    const [first] = StudySession.getInstances();
    handle = first ?? null;
  } catch {
    handle = null;
  }
  return handle;
}

async function remember(props: StudySessionProps | null): Promise<void> {
  await setItem(STATE_KEY, props);
}

/** The session this device thinks is running, if any. */
export async function currentSession(): Promise<StudySessionProps | null> {
  return getItem<StudySessionProps | null>(STATE_KEY, null);
}

/** Whether iOS is actually showing one, which the stored copy cannot know. */
export function hasLiveSession(): boolean {
  try {
    return StudySession.getInstances().length > 0;
  } catch {
    return false;
  }
}

/**
 * Begin a session, returning its props or null if it could not start.
 *
 * Null is a real outcome, not an error: Live Activities can be switched off per
 * app in iOS Settings, and starting one then throws. The caller says so rather
 * than pretending a session is running.
 */
export async function startSession(input: Omit<SessionInput, 'now'>): Promise<StudySessionProps | null> {
  // Exactly one at a time. iOS caps concurrent activities per app and a second
  // focus timer would be meaningless anyway.
  if (hasLiveSession()) await endSession();

  const props = buildSessionProps({ ...input, now: Date.now() });
  try {
    // The second argument is the one deep link applied to the whole card; the
    // third is the stale date, which is what dims it when the time runs out
    // without anything of ours running.
    handle = StudySession.start(props, 'nwplanner://tasks', new Date(props.endsAt));
  } catch {
    handle = null;
    return null;
  }
  await remember(props);
  return props;
}

async function push(next: StudySessionProps): Promise<StudySessionProps> {
  const activity = handle ?? attach();
  await remember(next);
  if (activity) {
    try {
      await activity.update(next, new Date(next.endsAt));
    } catch {
      // The activity was dismissed from the Lock Screen. The stored copy is
      // still the truth for the in-app control.
    }
  }
  return next;
}

/** Freeze the countdown where it stands. */
export async function pauseCurrentSession(): Promise<StudySessionProps | null> {
  const props = await currentSession();
  return props ? push(pauseSession(props, Date.now())) : null;
}

/** Pick it back up, giving back however long the pause lasted. */
export async function resumeCurrentSession(): Promise<StudySessionProps | null> {
  const props = await currentSession();
  return props ? push(resumeSession(props, Date.now())) : null;
}

/** Add time without starting over. */
export async function extendCurrentSession(minutes: number): Promise<StudySessionProps | null> {
  const props = await currentSession();
  return props ? push(extendSession(props, minutes, Date.now())) : null;
}

/**
 * Finish.
 *
 * `linger` leaves the finished card on the Lock Screen for a few minutes, which
 * is worth it when the timer ran out on its own — the student was not looking
 * at the phone, and the card is how they find out.
 */
export async function endSession(linger = false): Promise<void> {
  const activity = handle ?? attach();
  const props = await currentSession();
  if (activity) {
    try {
      await activity.end(
        linger ? after(new Date(Date.now() + 10 * 60_000)) : 'immediate',
        props ? { ...props, pausedAt: Date.now() } : undefined,
      );
    } catch {
      /* Already gone. */
    }
  }
  handle = null;
  await remember(null);
}

/**
 * Drop any session on sign-out.
 *
 * Not covered by clearWidget: an activity is an ActivityKit object rather than
 * App Group state, so it would otherwise survive the sign-out and show the
 * previous student's work on a shared phone.
 */
export async function clearLiveActivities(): Promise<void> {
  try {
    for (const activity of StudySession.getInstances()) {
      await activity.end('immediate');
    }
  } catch {
    /* Live Activities unavailable; nothing to clear. */
  }
  handle = null;
  await remember(null);
}
