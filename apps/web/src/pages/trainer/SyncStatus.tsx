import { ATTENDANCE_LABEL, OFFLINE_ROSTER_MAX_AGE_DAYS } from '@vta/shared';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { Modal, PageHeader, Spinner } from '../../components/ui';
import { removeOps, wipeAll, type QueuedOp } from '../../offline/store';
import { resolveConflict, syncNow } from '../../offline/sync';
import { useOffline } from '../../offline/useOffline';
import { longDate } from '../operations/AttendanceRecorder';

const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function since(iso: string | undefined): string {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  return time(iso);
}

/** TR-08: last sync time, what is waiting, what went wrong, and a way to retry. TR-09: what this phone keeps. */
export function SyncStatusPage() {
  const off = useOffline();
  const toast = useToast();
  const [confirmWipe, setConfirmWipe] = useState(false);
  if (!off.ready) return <Spinner />;

  const sync = async () => {
    const r = await syncNow();
    if (r.error) toast('error', r.error);
    else if (r.conflicts || r.rejected) toast('error', `${r.conflicts + r.rejected} need your attention`);
    else toast('success', r.sent ? `Synced ${r.saved} ${r.saved === 1 ? 'change' : 'changes'}` : 'Up to date');
  };
  const people = off.batches.reduce((n, b) => n + b.people.length, 0);

  return (
    <>
      <PageHeader title="Sync status" description="Attendance you take is saved on this phone first, then sent to AutoTalent Grid." />

      <section className="card grid gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-muted">Connection</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-semibold">
              {off.online ? <Wifi className="size-4 text-success" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
              {off.online ? 'Online' : 'Offline'}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Last synced</dt>
            <dd className="mt-0.5 font-semibold">{since(off.meta.lastSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted">Waiting to sync</dt>
            <dd className="mt-0.5 font-semibold">{off.pending.length}</dd>
          </div>
        </dl>
        <button type="button" className="btn-primary" disabled={!off.online || off.syncing} onClick={() => void sync()}>
          <RefreshCw className={`size-4 ${off.syncing ? 'animate-spin' : ''}`} aria-hidden />
          {off.syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {off.meta.lastError && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning sm:col-span-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {off.meta.lastError}
          </p>
        )}
      </section>

      {off.conflicts.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Needs your choice ({off.conflicts.length})</h2>
          <p className="mt-1 text-sm text-muted">A different mark was saved for these people after you took yours. Choose which one to keep.</p>
          <ul className="card mt-3 divide-y divide-line">
            {off.conflicts.map((o) => (
              <ConflictRow key={o.opId} op={o} />
            ))}
          </ul>
        </section>
      )}

      {off.rejected.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Not saved ({off.rejected.length})</h2>
          <p className="mt-1 text-sm text-muted">These can never be saved as they are. Remove them, and correct the attendance online if needed.</p>
          <ul className="card mt-3 divide-y divide-line">
            {off.rejected.map((o) => (
              <li key={o.opId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {o.candidateName}: {ATTENDANCE_LABEL[o.status]}
                  </p>
                  <p className="text-[13px] text-muted">
                    {o.batchName}, {longDate(o.date)}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] text-brand">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    {o.message}
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => void removeOps([o.opId])}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold">Waiting to sync ({off.pending.length})</h2>
        {off.pending.length === 0 ? (
          <p className="card mt-3 flex items-center gap-2 px-5 py-4 text-sm">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            Nothing waiting. Everything taken on this phone has been sent.
          </p>
        ) : (
          <ul className="card mt-3 divide-y divide-line">
            {off.pending.map((o) => (
              <li key={o.opId} className="flex items-center gap-3 px-5 py-3">
                <Clock className="size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {o.candidateName}: {ATTENDANCE_LABEL[o.status]}
                  </p>
                  <p className="text-[13px] text-muted">
                    {o.batchName}, {longDate(o.date)}, taken {time(o.capturedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-6 px-5 py-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Smartphone className="size-5" aria-hidden />
          On this phone
        </h2>
        <p className="mt-2 text-sm">
          {off.batches.length
            ? `${off.batches.length} running ${off.batches.length === 1 ? 'batch' : 'batches'} with ${people} people, refreshed ${since(off.meta.snapshotAt).toLowerCase()}.`
            : 'No batches stored.'}
        </p>
        <p className="mt-3 flex items-start gap-2 text-[13px] text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Only your running batches are kept: names, candidate IDs and attendance. No phone numbers, addresses or documents. It is deleted when you sign out, when someone else signs in on this phone, and
          after {OFFLINE_ROSTER_MAX_AGE_DAYS} days without a refresh.
        </p>
        <button type="button" className="btn-secondary btn-sm mt-4" onClick={() => setConfirmWipe(true)}>
          <Trash2 className="size-4" aria-hidden />
          Remove offline data
        </button>
      </section>

      <Modal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Remove offline data?"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmWipe(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await wipeAll();
                setConfirmWipe(false);
                toast('success', 'Offline data removed from this phone');
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <p>The roster stored on this phone will be deleted. It downloads again next time you are online.</p>
        {off.unsynced > 0 && (
          <p className="mt-3 font-semibold text-brand">
            {off.unsynced} {off.unsynced === 1 ? 'change has' : 'changes have'} not reached the server and will be lost.
          </p>
        )}
      </Modal>
    </>
  );
}

function ConflictRow({ op }: { op: QueuedOp }) {
  const [busy, setBusy] = useState(false);
  const choose = async (c: 'mine' | 'saved') => {
    setBusy(true);
    await resolveConflict(op, c);
    setBusy(false);
  };
  return (
    <li className="px-5 py-4">
      <p className="font-medium">{op.candidateName}</p>
      <p className="text-[13px] text-muted">
        {op.batchName}, {longDate(op.date)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-[13px] text-muted">Your mark</dt>
          <dd className="font-semibold">{ATTENDANCE_LABEL[op.status]}</dd>
          <dd className="text-[12px] text-muted">taken {time(op.capturedAt)}</dd>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <dt className="text-[13px] text-muted">Saved now</dt>
          <dd className="font-semibold">{op.server ? ATTENDANCE_LABEL[op.server.status] : '—'}</dd>
          {op.server && <dd className="text-[12px] text-muted">taken {time(op.server.capturedAt)}</dd>}
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void choose('mine')}>
          Use my mark
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void choose('saved')}>
          Keep saved mark
        </button>
      </div>
    </li>
  );
}
