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
import { getItem } from './storage';

const ANDROID_CHANNEL = 'planner-alerts';

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

/** Android needs a channel before anything can be delivered; iOS ignores this. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Task and reminder alerts',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
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
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  if (asked.granted) await ensureAndroidChannel();
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
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(item.at),
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
    pending.map(request => request.identifier),
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

/** Fires when a notification is tapped. Returns an unsubscribe function. */
export function onNotificationTapped(
  handler: (payload: { kind?: string; recordId?: string }) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    handler((response.notification.request.content.data || {}) as { kind?: string; recordId?: string });
  });
  return () => subscription.remove();
}
