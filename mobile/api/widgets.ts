// The device half of the home screen widgets: pushing props out to WidgetKit.
//
// The only file besides widgets/*.tsx that touches expo-widgets. What may be
// published is decided in utils/widgetSnapshot.ts; this pushes it.
//
// Worth being clear about the direction of travel, because it is the opposite
// of how the rest of the app reads data. A widget never reads the planner: it
// cannot, since records are encrypted under a key held in this app's Keychain
// and WidgetKit runs elsewhere. Instead the app writes finished, already
// minimised props into a shared App Group container each time the records
// change. That container is plain, unencrypted, and not scoped to a user —
// which is exactly why what goes into it is counts and clock times, and why
// clearing it on sign-out is part of the contract rather than housekeeping.
//
// Every widget module must be imported here even if nothing calls it directly.
// The native side stores a widget's layout when `createWidget` runs, and a
// timeline push for a widget whose layout was never stored fails.

import { addUserInteractionListener } from 'expo-widgets';
import { Reminder, Settings, Task } from '@/types';
import {
  buildWidgetTimeline,
  EMPTY_WIDGET_PROPS,
  TimelineEntry,
} from '@/utils/widgetSnapshot';
import DueToday from '@/widgets/DueToday';
import Progress from '@/widgets/Progress';
import ThisWeek from '@/widgets/ThisWeek';
import UpNext from '@/widgets/UpNext';
import { getItem } from './storage';

/** Every widget the app publishes. One timeline each, one clear each. */
const WIDGETS = [DueToday, UpNext, ThisWeek, Progress];

/**
 * Refresh every widget from the records currently cached.
 *
 * A timeline rather than a single snapshot, because no code of ours runs once
 * the app is closed: without entries scheduled ahead, a widget showing "3 due
 * today" would still say so tomorrow morning.
 *
 * All four widgets get the same props. A widget's configuration is applied when
 * its layout renders, not when the timeline is built — the generated provider
 * reads the same stored entries whatever the student chose — so the app has to
 * publish the superset and let each layout narrow it.
 */
export async function syncWidget(): Promise<number> {
  const [tasks, reminders, settings] = await Promise.all([
    getItem<Task[]>('nw_tasks', []),
    getItem<Reminder[]>('nw_reminders', []),
    getItem<Partial<Settings>>('nw_settings', {}),
  ]);

  const entries = buildWidgetTimeline({
    tasks,
    reminders,
    now: Date.now(),
    showTitles: settings.widgetShowTitles ?? false,
  });

  for (const widget of WIDGETS) widget.updateTimeline(entries as TimelineEntry[]);
  return entries.length;
}

/**
 * Wipe every widget back to nothing.
 *
 * Called on sign-out. The App Group container outlives the session and belongs
 * to the app rather than to whoever was signed in, so without this a second
 * student on a shared phone would see the first one's day on the home screen —
 * and, with titles opted in, on the Lock Screen.
 */
export function clearWidget(): void {
  const blank = [{ date: new Date(), props: { ...EMPTY_WIDGET_PROPS } }];
  for (const widget of WIDGETS) widget.updateTimeline(blank as TimelineEntry[]);
}

/**
 * Handle a tick box tapped on a widget.
 *
 * The widget has already rewritten its own props by the time this runs, so the
 * student sees the box fill immediately; this is what makes the change real.
 *
 * It only arrives while the app is running — the native side posts the event
 * within its own process — so taps made against a closed app are lost here and
 * recovered by the ordinary refresh on next foreground, which rebuilds every
 * timeline from the records. That is why the widget's optimistic edit has to be
 * something a rebuild can correct rather than something it would contradict.
 */
export function onWidgetAction(complete: (taskId: string) => Promise<void>): () => void {
  const subscription = addUserInteractionListener(event => {
    const target = String(event.target || '');
    const separator = target.indexOf(':');
    if (separator < 0) return;
    const action = target.slice(0, separator);
    const recordId = target.slice(separator + 1);
    if (action !== 'done' || !recordId) return;
    complete(recordId)
      .then(() => syncWidget())
      .catch(() => {});
  });
  return () => subscription.remove();
}
