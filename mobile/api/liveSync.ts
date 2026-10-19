import { doc, onSnapshot } from 'firebase/firestore';
import { plannerFirestore } from '@/lib/firebase';
import { changedKinds, type SyncMarker } from '@/utils/syncMarker';
import { apiConfigured, CLIENT_ID } from './client';
import { refreshPlannerData, type Kind } from './plannerClient';
import { getStorageUid } from './storage';

// Last marker seen per account, kept across subscriptions so a change made
// elsewhere while this app was in the background is caught on return even
// when the resume refresh is throttled.
const markers = new Map<string, SyncMarker>();

/**
 * Listen for changes made on other devices while this app is in front.
 *
 * The backend bumps `users/{uid}/meta/sync` in the same transaction as every
 * record write. It holds counters and the writing device's id, nothing else,
 * and is the only document the Firestore rules let a client read. When it
 * moves, refetch the kinds that moved through the API, which publishes the
 * widget snapshot as a side effect.
 *
 * Any failure (rules not deployed, offline, unconfigured build) leaves the
 * launch, resume and pull-to-refresh paths exactly as they were.
 */
export function watchPlannerChanges(uid: string): () => void {
  const db = plannerFirestore();
  if (!db || !apiConfigured()) return () => {};
  const pending = new Set<Kind>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  try {
    stop = onSnapshot(doc(db, 'users', uid, 'meta', 'sync'), snapshot => {
      if (getStorageUid() !== uid) return;
      const next = (snapshot.data() ?? { version: 0 }) as SyncMarker;
      const kinds = changedKinds(markers.get(uid) ?? null, next, CLIENT_ID);
      markers.set(uid, next);
      if (!kinds.length) return;
      kinds.forEach(kind => pending.add(kind));
      // A burst of writes (a recurring series, an import) is one refresh.
      clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = [...pending];
        pending.clear();
        if (getStorageUid() === uid) void refreshPlannerData(true, batch).catch(() => {});
      }, 300);
    }, () => { /* advisory: fall back to launch/resume refresh */ });
  } catch { /* advisory */ }
  return () => { clearTimeout(timer); stop(); };
}
