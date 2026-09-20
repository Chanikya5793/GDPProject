import { useEffect } from 'react';
import { onPlannerDataChanged } from '@/api/plannerClient';
import { getItem, getStorageUid } from '@/api/storage';

/** Reflect widget/outbox changes on an already mounted screen without starting
 * another network refresh (which would emit another data-change event).
 */
export function usePlannerCacheUpdates<T extends { userId: string }>(
  kind: 'task' | 'reminder', userId: string | undefined, receive: (records: T[]) => void,
): void {
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let readVersion = 0;
    const stop = onPlannerDataChanged(() => {
      const version = ++readVersion;
      getItem<T[]>(kind === 'task' ? 'nw_tasks' : 'nw_reminders', []).then(records => {
        if (active && version === readVersion && getStorageUid() === userId) {
          receive(records.filter(record => record.userId === userId));
        }
      }).catch(() => {});
    });
    return () => { active = false; stop(); };
  }, [kind, userId, receive]);
}
