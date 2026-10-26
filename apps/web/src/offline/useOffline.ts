import { useEffect, useState, useSyncExternalStore } from 'react';
import { readAll, subscribe, type OfflineData, type QueuedOp } from './store';
import { isSyncing, online } from './sync';

export interface OfflineView extends OfflineData {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  pending: QueuedOp[];
  conflicts: QueuedOp[];
  rejected: QueuedOp[];
  /** Changes that have not reached the server: waiting, in conflict, or not accepted. */
  unsynced: number;
}

const empty: OfflineData = { meta: {}, batches: [], ops: [] };

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    online,
    () => true,
  );
}

/** The phone's offline data, kept current as it changes (in this tab and others). */
export function useOffline(): OfflineView {
  const [data, setData] = useState<OfflineData>(empty);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(isSyncing());
  const isOnline = useOnline();
  useEffect(() => {
    let alive = true;
    const load = () =>
      void readAll()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setSyncing(isSyncing());
          setReady(true);
        })
        .catch(() => alive && setReady(true));
    load();
    const off = subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const pending = data.ops.filter((o) => o.state === 'pending');
  const conflicts = data.ops.filter((o) => o.state === 'conflict');
  const rejected = data.ops.filter((o) => o.state === 'rejected');
  return { ...data, ready, online: isOnline, syncing, pending, conflicts, rejected, unsynced: data.ops.length };
}

/** "Today" as the server counts it (India time), moved on by the days passed since the roster was fetched. */
export function localToday(meta: OfflineData['meta'], now = Date.now()): string {
  const ist = (t: number) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (!meta.serverToday || !meta.snapshotAt) return ist(now);
  const days = Math.round((Date.parse(`${ist(now)}T00:00:00Z`) - Date.parse(`${ist(Date.parse(meta.snapshotAt))}T00:00:00Z`)) / 86_400_000);
  return new Date(Date.parse(`${meta.serverToday}T00:00:00Z`) + Math.max(0, days) * 86_400_000).toISOString().slice(0, 10);
}
