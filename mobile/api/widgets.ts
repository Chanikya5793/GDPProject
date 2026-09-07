// The device half of the home screen widget: pushing props out to WidgetKit.
//
// The only file besides widgets/DueToday.tsx that touches expo-widgets. What
// may be published is decided in utils/widgetSnapshot.ts; this pushes it.
//
// Worth being clear about the direction of travel, because it is the opposite
// of how the rest of the app reads data. The widget never reads the planner:
// it cannot, since records are encrypted under a key held in this app's
// Keychain and WidgetKit runs elsewhere. Instead the app writes finished,
// already-minimised props into a shared App Group container each time the
// records change. That container is plain, unencrypted, and not scoped to a
// user — which is exactly why what goes into it is counts and clock times, and
// why clearing it on sign-out is part of the contract rather than housekeeping.

import { Reminder, Settings, Task } from '@/types';
import {
  buildWidgetTimeline,
  EMPTY_WIDGET_PROPS,
  WidgetProps,
} from '@/utils/widgetSnapshot';
import DueToday from '@/widgets/DueToday';
import { getItem } from './storage';

/**
 * Refresh the widget from the records currently cached.
 *
 * A timeline rather than a single snapshot, because no code of ours runs once
 * the app is closed: without entries scheduled ahead, a widget showing "3 due
 * today" would still say so tomorrow morning.
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

  DueToday.updateTimeline(entries);
  return entries.length;
}

/**
 * Wipe the widget back to nothing.
 *
 * Called on sign-out. The App Group container outlives the session and belongs
 * to the app rather than to whoever was signed in, so without this a second
 * student on a shared phone would see the first one's day on the home screen —
 * and, with titles opted in, on the Lock Screen.
 */
export function clearWidget(): void {
  DueToday.updateTimeline([{ date: new Date(), props: { ...EMPTY_WIDGET_PROPS } as WidgetProps }]);
}
