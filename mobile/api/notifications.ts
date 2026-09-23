// The device half of notifications: permission, scheduling, and clean-up.
//
// This is deliberately the only file in the app that imports
// expo-notifications. Everything that decides *what* to schedule lives in
// utils/notificationPlan.ts as pure functions with tests; what is left here is
// the part that talks to iOS, which cannot run in node.
//
// Alerts are scheduled on the device from records already cached on the device.
// Nothing is sent to a push service, and no token is registered, so a student's
// due dates never leave their phone in order to be announced on it.
//
// Note for anyone extending this: installing expo-notifications auto-applies
// its config plugin, which writes the `aps-environment` push entitlement even
// though nothing here uses push. plugins/withoutPushEntitlement.js removes it
// again — see that file before adding anything that needs a real push token.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Reminder, Settings, Task } from '@/types';
import {
  buildNotificationPlan,
  diffNotificationPlan,
  NOTIFICATION_BUDGET,
  PlannedNotification,
} from '@/utils/notificationPlan';
import { formatRemaining, StudySessionProps } from '@/utils/studySession';
import { getItem } from './storage';

// Android fixes a channel's importance when it is first created, so raising it
// to heads-up meant a new id; the old, silent one is removed on sight.
const ANDROID_CHANNEL = 'planner-alerts-v2';
const LEGACY_ANDROID_CHANNELS = ['planner-alerts'];

// Android's stand-in for the iOS Live Activity. One identifier for both the
// ongoing card and the alert that ends it, so the alert replaces the card in
// the shade when the time runs out with nothing of ours running.
const FOCUS_CHANNEL = 'focus-session';
const FOCUS_ID = 'focus-session';

export interface SyncResult {
  scheduled: number;
  cancelled: number;
  /** False when the student has not granted permission; nothing was touched. */
  permitted: boolean;
}

const NO_SYNC: SyncResult = { scheduled: 0, cancelled: 0, permitted: false };

/**
 * How a notification behaves while the app is open.
 *
 * `shouldShowAlert` is deprecated in SDK 57 and replaced by the two more
 * specific flags: banner is the drop-down at the top, list is Notification
 * Centre. Both are wanted — an alert dismissed by accident should still be
 * findable afterwards.
 */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Android needs a channel before anything can be delivered, and Android 13
 * will not show the permission prompt until one exists; iOS ignores this.
 * HIGH importance is what gives the heads-up banner iOS shows by default.
 */
let channelReady: Promise<void> | null = null;
export function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= (async () => {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Task and reminder alerts',
      description: 'Due dates and reminders you have scheduled in the planner.',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 150, 250],
      // Private: the lock screen says an alert arrived without showing its text.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    for (const legacy of LEGACY_ANDROID_CHANNELS) {
      await Notifications.deleteNotificationChannelAsync(legacy).catch(() => {});
    }
  })().catch(error => { channelReady = null; throw error; });
  return channelReady;
}

/** Whether alerts are already allowed, without prompting for them. */
export async function hasNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

/**
 * Ask for permission, prompting only if iOS has not already decided.
 *
 * Asking again after a refusal does nothing on iOS — the system silently
 * resolves with the previous answer — so the caller is told plainly rather than
 * left waiting for a prompt that will never appear.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureAndroidChannel().catch(() => {});
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

async function schedule(item: PlannedNotification): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: item.id,
    content: {
      title: item.title,
      body: item.body,
      sound: 'default',
      // Read back on tap to open the right screen. Ids only: the notification
      // payload is stored by the OS outside the app's encrypted cache, so it
      // carries no more of the record than the text already on screen.
      data: { kind: item.kind, recordId: item.recordId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(item.at),
      // On the trigger, not the content: SDK 57 reads it from here, and a
      // channelId spread into the content is silently dropped.
      channelId: ANDROID_CHANNEL,
    },
  });
}

/**
 * Bring the pending alerts in line with the records currently cached.
 *
 * Reads the same cache the screens read, so it is correct offline and needs no
 * network. Safe to call often: the diff means an unchanged plan does no work,
 * and a single edited task costs one cancel and one schedule rather than a full
 * rebuild of the queue.
 */
export async function syncScheduledNotifications(): Promise<SyncResult> {
  if (!await hasNotificationPermission()) return NO_SYNC;
  await ensureAndroidChannel();

  const [tasks, reminders, settings] = await Promise.all([
    getItem<Task[]>('nw_tasks', []),
    getItem<Reminder[]>('nw_reminders', []),
    getItem<Partial<Settings>>('nw_settings', {}),
  ]);

  const plan = buildNotificationPlan({
    tasks,
    reminders,
    settings: {
      dueDateAlerts: settings.dueDateAlerts ?? true,
      reminderDefault: settings.reminderDefault ?? 30,
    },
    now: Date.now(),
    budget: NOTIFICATION_BUDGET,
  });

  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const { cancel, schedule: toSchedule } = diffNotificationPlan(
    // The focus session's alert is not part of the plan; left in, the diff
    // would cancel it as stale.
    pending.map(request => request.identifier).filter(id => id !== FOCUS_ID),
    plan,
  );

  for (const id of cancel) await Notifications.cancelScheduledNotificationAsync(id);
  for (const item of toSchedule) await schedule(item);
  return { scheduled: toSchedule.length, cancelled: cancel.length, permitted: true };
}

/**
 * Drop every pending alert.
 *
 * Called on sign-out, and this is not tidiness. The system notification queue
 * belongs to the app, not to a user: without this, signing in as a second
 * student on a shared phone would keep announcing the first one's assignments,
 * long after their encrypted records became unreadable.
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}

const handledResponses = new Set<string>();

/**
 * Fires when a notification is tapped. Returns an unsubscribe function.
 *
 * A tap that launched the app from cold happened before this listener
 * existed — on Android almost always — so the last response is replayed once,
 * and only if nobody has handled it yet.
 */
export function onNotificationTapped(
  handler: (payload: { kind?: string; recordId?: string }) => void,
): () => void {
  let live = true;
  const deliver = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (!live || handledResponses.has(id)) return;
    handledResponses.add(id);
    handler((response.notification.request.content.data || {}) as { kind?: string; recordId?: string });
    Notifications.clearLastNotificationResponse();
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(deliver);
  const last = Notifications.getLastNotificationResponse();
  if (last) deliver(last);
  return () => { live = false; subscription.remove(); };
}


/**
 * Show a running focus session outside the app, on Android.
 *
 * iOS has the Live Activity for this (api/liveActivity.ts); Android gets an
 * ongoing notification that says when the session ends, and an alert at that
 * moment which takes the ongoing one's place. Quietly does nothing without
 * notification permission — the in-app countdown still runs.
 */
export async function showFocusSession(props: StudySessionProps): Promise<void> {
  if (Platform.OS !== 'android' || !await hasNotificationPermission()) return;
  await ensureAndroidChannel();
  await Notifications.setNotificationChannelAsync(FOCUS_CHANNEL, {
    name: 'Focus session',
    description: 'The countdown for a focus session while it runs.',
    importance: Notifications.AndroidImportance.LOW,
    showBadge: false,
  });
  await Notifications.cancelScheduledNotificationAsync(FOCUS_ID).catch(() => {});

  const paused = props.pausedAt > 0;
  const until = new Date(props.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const subject = props.titlesAllowed && props.label ? props.label : props.category;
  await Notifications.scheduleNotificationAsync({
    identifier: FOCUS_ID,
    content: {
      title: paused ? 'Focus session paused' : 'Focusing',
      body: [paused ? `${formatRemaining(props, Date.now())} left` : `Until ${until}`, subject]
        .filter(Boolean).join(' · '),
      sticky: true,
      autoDismiss: false,
      data: { kind: 'focus' },
    },
    trigger: { channelId: FOCUS_CHANNEL },
  });
  if (paused) return;
  await Notifications.scheduleNotificationAsync({
    identifier: FOCUS_ID,
    content: {
      title: 'Focus session finished',
      body: 'Time for a break.',
      sound: 'default',
      data: { kind: 'focus' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(props.endsAt), channelId: ANDROID_CHANNEL,
    },
  });
}

/** Take the focus session's card and pending alert away. */
export async function clearFocusSession(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.cancelScheduledNotificationAsync(FOCUS_ID).catch(() => {});
  await Notifications.dismissNotificationAsync(FOCUS_ID).catch(() => {});
}
