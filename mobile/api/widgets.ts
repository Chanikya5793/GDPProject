import { NativeModules, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import type { Reminder, Settings, Task } from '@/types';
import { buildWidgetSnapshot } from '@/utils/widgetSnapshot';
import { resolveWidgetCommand, type WidgetCommand } from '@/utils/widgetCommands';
import { getItem, getStorageUid, onStorageScopeChange } from './storage';
import { updatePlannerItem } from './plannerClient';
import { addLog } from './logs';

interface WidgetBridge {
  pendingCount(): Promise<number>;
  publish(json: string): Promise<void>;
  claim(owner: string): Promise<string>;
  acknowledge(owner: string, commandId: string, notice: string): Promise<void>;
  clear(): Promise<void>;
}

// iOS: plugins/widgets/PlannerWidgetsBridge.swift. Android: the local Expo
// module in modules/planner-widgets-android, which keeps the same contract.
const bridge: WidgetBridge | undefined = Platform.OS === 'ios'
  ? NativeModules.PlannerWidgetsBridge
  : Platform.OS === 'android'
    ? requireOptionalNativeModule<WidgetBridge>('PlannerWidgetsBridge') ?? undefined
    : undefined;
let generation = 0;
let serial: Promise<unknown> = Promise.resolve();
let previousUid = getStorageUid();

// Serialize publication and clearing so late reads cannot republish a signed-out account.
onStorageScopeChange(() => {
  generation += 1;
  const nextUid = getStorageUid();
  // The first restoration must preserve taps made while the app was closed.
  if (previousUid !== null || nextUid === null) void enqueue(() => bridge?.clear()).catch(() => {});
  previousUid = nextUid;
});

function enqueue<T>(work: () => Promise<T> | undefined): Promise<T | undefined> {
  const next = serial.catch(() => {}).then(work);
  serial = next;
  return next;
}

export async function syncWidget(): Promise<number> {
  const epoch = generation;
  const uid = getStorageUid();
  if (!bridge || !uid) return 0;
  return await enqueue(async () => {
    const current = () => generation === epoch && getStorageUid() === uid;
    if (!current()) return 0;
    const owner = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `planner-widgets:${uid}`);
    if (!current()) return 0;
    const commands: WidgetCommand[] = JSON.parse(await bridge.claim(owner));
    for (const command of commands) {
      if (!current()) return 0;
      const key = command.kind === 'task' ? 'nw_tasks' : 'nw_reminders';
      const records = await getItem<(Task | Reminder)[]>(key, []);
      if (!current()) return 0;
      const decision = resolveWidgetCommand(command, owner, records.filter(record => record.userId === uid));
      if (decision.status === 'complete') {
        const before = decision.record;
        try {
          // Preserve numeric/string IDs and use the ordinary encrypted outbox.
          // Replays set completed=true, never toggle a completed item back.
          const after = await updatePlannerItem(command.kind, before.id, { completed: true }, {
            userId: uid, revision: command.revision ?? null, date: command.date, time: command.time,
          });
          if (!current()) return 0;
          await addLog('completed', command.kind, after.title, { entityId: before.id, before, after });
        } catch (error) {
          if (!current()) return 0;
          const status = (error as { status?: number }).status;
          if (status === 409 || status === 404) {
            await bridge.acknowledge(owner, command.id, 'An item changed. Open planner to review.');
          }
          // Other failures retain the durable command for the next refresh.
          continue;
        }
      }
      if (!current()) return 0;
      await bridge.acknowledge(owner, command.id,
        decision.status === 'stale' ? 'An item changed. Open planner to review.' : '');
    }
    const [tasks, reminders, settings] = await Promise.all([
      getItem<Task[]>('nw_tasks', []), getItem<Reminder[]>('nw_reminders', []),
      getItem<Partial<Settings>>('nw_settings', {}),
    ]);
    if (!current()) return 0;
    // Titles are on unless the student switched them off themselves. A stored
    // `false` without that decision is the old default carried forward, and
    // SettingsContext rewrites it on its next load; publishing must agree with
    // it in the meantime or the first widget after an update stays nameless.
    const decided = settings.widgetTitlesDecided === true;
    const showTitles = decided ? settings.widgetShowTitles !== false : true;
    const snapshot = buildWidgetSnapshot({
      tasks: tasks.filter(item => item.userId === uid), reminders: reminders.filter(item => item.userId === uid),
      now: Date.now(), showTitles, owner,
    });
    await bridge.publish(JSON.stringify(snapshot));
    return snapshot.items.length;
  }) ?? 0;
}

export async function clearWidget(): Promise<void> {
  generation += 1;
  await enqueue(() => bridge?.clear());
}

export function nativeWidgetsAvailable(): boolean { return Boolean(bridge); }

export async function syncPendingWidgetActions(): Promise<void> {
  if (bridge && await bridge.pendingCount() > 0) await syncWidget();
}
