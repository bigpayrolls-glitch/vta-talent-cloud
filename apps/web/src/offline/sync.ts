import { SYNC_MAX_OPS, type MeDto, type OfflineSnapshot, type SyncResponse } from '@vta/shared';
import { api, ApiError, hasCsrfToken, setCsrfToken } from '../lib/api';
import { applyLocalMark, enqueue, expireOldRoster, notifyChanged, readAll, recordSync, removeOps, saveSnapshot, updateOp, type QueuedOp } from './store';

/**
 * Sends queued attendance changes to the server (TR-04) and keeps the phone's roster fresh.
 * Runs when the app opens, when the connection comes back, when the app comes to the front,
 * every 30 seconds while changes are waiting, and when the trainer taps "Sync now".
 */

let running: Promise<SyncSummary> | null = null;
let syncing = false;
export const isSyncing = () => syncing;

export interface SyncSummary {
  sent: number;
  saved: number;
  conflicts: number;
  rejected: number;
  /** Set when the sync stopped early; queued changes are kept. */
  error?: string;
}

const offlineMessage = 'No connection. Changes are kept on this phone and will sync when you are back online.';

export function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** The sync request needs the CSRF token, which is never stored on the phone. */
async function ensureCsrf() {
  if (hasCsrfToken()) return;
  const me = await api.get<MeDto>('/auth/me');
  setCsrfToken(me.csrfToken);
}

function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return offlineMessage;
    if (e.status === 401) return 'Your sign-in has ended. Sign in again to sync; your changes are kept on this phone.';
    if (e.status === 403) return 'This account can no longer record attendance. Ask an AutoTalent Grid administrator.';
    return e.message;
  }
  return 'Sync failed. Your changes are kept on this phone.';
}

export function syncNow(): Promise<SyncSummary> {
  running ??= (async () => {
    syncing = true;
    notifyChanged();
    const summary: SyncSummary = { sent: 0, saved: 0, conflicts: 0, rejected: 0 };
    try {
      if (!online()) {
        summary.error = offlineMessage;
        await recordSync({ lastError: offlineMessage });
        return summary;
      }
      const { ops } = await readAll();
      const pending = ops.filter((o) => o.state === 'pending');
      if (pending.length) await ensureCsrf();
      for (let i = 0; i < pending.length; i += SYNC_MAX_OPS) {
        const chunk = pending.slice(i, i + SYNC_MAX_OPS);
        const res = await api.post<SyncResponse>('/sync/attendance', {
          ops: chunk.map(({ opId, batchId, date, candidateId, status, capturedAt, force }) => ({ opId, batchId, date, candidateId, status, capturedAt, ...(force ? { force } : {}) })),
        });
        summary.sent += chunk.length;
        const done: string[] = [];
        for (const r of res.results) {
          const op = chunk.find((o) => o.opId === r.opId);
          if (!op) continue;
          if (r.outcome === 'applied' || r.outcome === 'unchanged' || r.outcome === 'duplicate') {
            await applyLocalMark(op.batchId, op.date, op.candidateId, op.status, op.capturedAt);
            done.push(op.opId);
            summary.saved++;
          } else if (r.outcome === 'conflict') {
            await updateOp(op.opId, { state: 'conflict', message: r.message, server: r.server });
            summary.conflicts++;
          } else {
            await updateOp(op.opId, { state: 'rejected', message: r.message });
            summary.rejected++;
          }
        }
        await removeOps(done);
      }
      await refreshSnapshot();
      await recordSync({ lastSyncAt: new Date().toISOString(), lastError: null });
      return summary;
    } catch (e) {
      summary.error = explain(e);
      await recordSync({ lastError: summary.error });
      return summary;
    } finally {
      syncing = false;
      running = null;
      notifyChanged();
    }
  })();
  return running;
}

/** Downloads the trainer's running batches. Fails quietly offline (the phone keeps what it has). */
export async function refreshSnapshot(): Promise<boolean> {
  if (!online()) return false;
  try {
    await saveSnapshot(await api.get<OfflineSnapshot>('/trainer/offline-snapshot'));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) await saveSnapshot({ today: '', generatedAt: new Date().toISOString(), batches: [] });
    return false;
  }
}

/** Conflict (TR-04): the trainer keeps their own mark (sent again as a new, forced change) or the saved one. */
export async function resolveConflict(op: QueuedOp, choice: 'mine' | 'saved'): Promise<void> {
  if (choice === 'mine') {
    await enqueue([{ batchId: op.batchId, batchName: op.batchName, date: op.date, candidateId: op.candidateId, candidateName: op.candidateName, status: op.status, force: true }]);
    void syncNow();
  } else {
    if (op.server) await applyLocalMark(op.batchId, op.date, op.candidateId, op.server.status, op.server.capturedAt);
    await removeOps([op.opId]);
  }
}

let started = false;
/** Starts automatic syncing for a signed-in trainer. Safe to call more than once. */
export function startAutoSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const kick = () => void syncNow();
  window.addEventListener('online', kick);
  window.addEventListener('offline', () => notifyChanged());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
  window.setInterval(async () => {
    if (!online() || syncing) return;
    const { ops } = await readAll();
    if (ops.some((o) => o.state === 'pending')) kick();
  }, 30_000);
  void expireOldRoster().then(kick);
}
