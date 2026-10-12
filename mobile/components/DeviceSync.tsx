import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { onPlannerDataChanged, onPlannerSyncChanged, refreshPlannerData } from '@/api/plannerClient';
import { getItem, setItem } from '@/api/storage';
import {
  cancelAllNotifications,
  configureNotifications,
  ensureAndroidChannel,
  requestNotificationPermission,
  syncScheduledNotifications,
  onNotificationTapped,
} from '@/api/notifications';
import { clearWidget, syncPendingWidgetActions, syncWidget } from '@/api/widgets';
import { clearLiveActivities } from '@/api/liveActivity';

const ASKED_KEY = 'nw_notifications_asked';

/**
 * Keeps what the phone shows outside the app — pending alerts and the home
 * screen widget — in step with the planner.
 *
 * Renders nothing. It exists as a component rather than a module so it can sit
 * inside the auth and settings providers and see the same signed-in user and
 * the same preferences the screens do.
 *
 * Both surfaces are driven by the same three things and nothing else: a change
 * to the cached records, a change to the settings that shape them, and the app
 * coming back to the foreground. The last one matters more than it looks. Both
 * surfaces are scheduled ahead — alerts because iOS holds only so many pending,
 * the widget because no JavaScript of ours runs once the app is closed — so
 * foregrounding is when anything beyond that horizon gets its turn.
 */
export default function DeviceSync() {
  const { user, loading } = useAuth();
  const { settings } = useSettings();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    configureNotifications();
    // Created up front: Android files alerts under a fallback channel, with
    // none of this one's settings, when the channel does not exist yet.
    ensureAndroidChannel().catch(() => {});
  }, []);

  useEffect(() => {
    // A restored session is still resolving, so `user` is briefly null on every
    // cold launch. Acting on that would cancel the whole queue and rebuild it
    // seconds later, leaving a window with no alerts scheduled at all.
    if (loading) return;

    if (!user) {
      // Signed out. The system queue is not scoped to a user, so alerts naming
      // this student's work must go before anyone else can sign in.
      cancelAllNotifications().catch(() => {});
      clearWidget().catch(() => {});
      // Not covered by clearWidget: a Live Activity lives in ActivityKit
      // rather than the App Group, so it would otherwise outlast the session
      // and put the previous student's work on a shared phone's Lock Screen.
      clearLiveActivities().catch(() => {});
      return;
    }

    let active = true;

    // Asked once, on the first sign-in, rather than at launch: a permission
    // prompt in front of the login screen is asking for something the app has
    // not yet given a reason for. iOS only ever shows the system prompt once,
    // so the flag is about not calling the module on every launch — after a
    // refusal the Settings screen is the way back.
    const askOnce = async () => {
      if (await getItem<boolean>(ASKED_KEY, false)) return;
      await setItem(ASKED_KEY, true);
      await requestNotificationPermission();
    };

    // Coalesced: a batch of confirmed changes writes the cache once per record,
    // and each of those would otherwise start its own pass over the queue.
    const sync = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!active) return;
        syncScheduledNotifications().catch(() => {});
        syncWidget().catch(() => {});
      }, 400);
    };

    // Widget publication must not wait for the notification permission dialog.
    void askOnce().catch(() => {});
    sync();
    // One pass per launch or return: durable widget taps go into the outbox
    // first, so the cloud read that follows cannot make them disappear.
    // Publication itself is driven by the data and cloud events below.
    const refresh = () => {
      void syncPendingWidgetActions().then(() => refreshPlannerData()).catch(() => {});
    };
    refresh();
    const stopWatchingData = onPlannerDataChanged(sync);
    const stopWatchingCloud = onPlannerSyncChanged(sync);
    // Widgets are only tappable while this app is in the background, so
    // coming back is the moment to look; no polling while active.
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') { sync(); refresh(); }
    });

    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      stopWatchingData();
      stopWatchingCloud();
      subscription.remove();
    };
  }, [user?.id, loading, settings.dueDateAlerts, settings.reminderDefault, settings.widgetShowTitles]);

  // A tapped alert should land on the thing it was about, not the home screen.
  // Subscribed once someone is signed in: a cold-start tap is replayed on
  // subscribe, and navigating before the session and the navigator exist
  // would either throw or be bounced to the login screen.
  const signedIn = Boolean(user) && !loading;
  useEffect(() => {
    if (!signedIn) return;
    return onNotificationTapped(payload => {
      if (payload.kind === 'focus') {
        setTimeout(() => router.navigate('/(tabs)'), 0);
        return;
      }
      const screen = payload.kind === 'reminder' ? '/(tabs)/reminders' : '/(tabs)/tasks';
      setTimeout(() => {
        router.push(payload.recordId
          ? { pathname: screen, params: { focus: String(payload.recordId) } }
          : screen);
      }, 0);
    });
  }, [signedIn]);

  return null;
}
