import { useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, type AttendanceStatus } from '@vta/shared';
import { AlertTriangle, Check, Clock, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Spinner } from '../../components/ui';
import { enqueue } from '../../offline/store';
import { refreshSnapshot, syncNow } from '../../offline/sync';
import { localToday, useOffline } from '../../offline/useOffline';

const BUTTON: Record<AttendanceStatus, string> = {
  present: 'aria-pressed:bg-success aria-pressed:text-white aria-pressed:border-success',
  late: 'aria-pressed:bg-warning aria-pressed:text-white aria-pressed:border-warning',
  absent: 'aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand',
  excused: 'aria-pressed:bg-ink aria-pressed:text-white aria-pressed:border-ink',
};

export const longDate = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * TR-03 / TR-04: the trainer marks attendance on the phone. Marks are saved on the phone first and sent to the
 * server straight away when there is a connection, or later when it comes back. Works the same online and offline.
 */
export function AttendanceRecorder({ batchId }: { batchId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const off = useOffline();
  const [date, setDate] = useState('');
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  // Fresh roster when there is a connection; otherwise the phone's copy.
  useEffect(() => {
    let alive = true;
    void refreshSnapshot().finally(() => alive && setRefreshing(false));
    return () => {
      alive = false;
    };
  }, [batchId]);

  const batch = off.batches.find((b) => b.id === batchId);
  const today = localToday(off.meta);
  const maxDate = batch ? (batch.endDate < today ? batch.endDate : today) : today;
  const effectiveDate = date || maxDate;

  const saved = useMemo(() => {
    const m: Record<string, AttendanceStatus> = {};
    for (const x of batch?.marks ?? []) if (x.date === effectiveDate) m[x.candidateId] = x.status;
    return m;
  }, [batch, effectiveDate]);
  const queued = useMemo(() => new Map(off.ops.filter((o) => o.batchId === batchId && o.date === effectiveDate).map((o) => [o.candidateId, o])), [off.ops, batchId, effectiveDate]);
  const sessions = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const m of batch?.marks ?? []) if (m.status === 'present' || m.status === 'late') byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1);
    for (const m of batch?.marks ?? []) if (!byDate.has(m.date)) byDate.set(m.date, 0);
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [batch]);

  if (!off.ready || (!batch && refreshing)) return <Spinner />;
  if (!batch) {
    return (
      <EmptyState
        title="Not available on this phone"
        body={off.online ? 'Attendance can be taken here only for running batches you teach.' : 'You are offline and this batch is not stored on this phone. Open it once while connected.'}
      />
    );
  }

  const people = batch.people;
  // What each person shows: an unsaved choice, else the change waiting to sync, else what the server has.
  const shown = (id: string): AttendanceStatus | undefined => draft[id] ?? queued.get(id)?.status ?? saved[id];
  const baseline = (id: string): AttendanceStatus | undefined => queued.get(id)?.status ?? saved[id];
  const changed = people.filter((p) => !p.locked && draft[p.candidateId] && draft[p.candidateId] !== baseline(p.candidateId));
  const unmarked = people.filter((p) => !shown(p.candidateId)).length;
  const waiting = [...queued.values()].filter((o) => o.state === 'pending').length;
  const problems = [...queued.values()].filter((o) => o.state !== 'pending').length;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await enqueue(
        changed.map((p) => ({ batchId, batchName: batch.name, date: effectiveDate, candidateId: p.candidateId, candidateName: p.name, status: draft[p.candidateId]! })),
      );
      setDraft({});
      const n = changed.length;
      if (!off.online) {
        toast('success', `Saved on this phone. ${plural(n, 'change')} will sync when you are back online.`);
        return;
      }
      const r = await syncNow();
      // The roster's attendance figures and alerts come from the server.
      void qc.invalidateQueries({ queryKey: ['batch', batchId] });
      void qc.invalidateQueries({ queryKey: ['attendance', batchId] });
      if (r.error) toast('success', `Saved on this phone. ${plural(n, 'change')} waiting to sync.`);
      else if (r.conflicts || r.rejected) setError(`${plural(r.conflicts + r.rejected, 'mark')} could not be saved. Open Sync status to choose what to keep.`);
      else toast('success', `Attendance saved for ${longDate(effectiveDate)} (${plural(n, 'change')})`);
    } catch {
      setError('Attendance could not be saved on this phone. Try again.');
    } finally {
      setSaving(false);
    }
  };

  /** Fills in only the people not marked yet; anyone already marked keeps their mark. */
  const markRest = (s: AttendanceStatus) => {
    const next = { ...draft };
    for (const p of people) if (!p.locked && !shown(p.candidateId)) next[p.candidateId] = s;
    setDraft(next);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      {/* overflow-clip, not overflow-hidden: hidden would make the card its own scroll box and break the sticky save bar. */}
      <section className="card overflow-clip">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <label htmlFor="att-date" className="field-label">Session date</label>
            <input
              id="att-date"
              type="date"
              className="field-input w-52"
              min={batch.startDate}
              max={maxDate}
              value={effectiveDate}
              onChange={(e) => {
                setDate(e.target.value);
                setDraft({});
              }}
            />
          </div>
          {people.length > 0 && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => markRest('present')}>
              <Check className="size-4" aria-hidden />
              Mark the rest present
            </button>
          )}
        </div>
        {!off.online && (
          <p className="border-b border-line bg-surface/60 px-5 py-2.5 text-[13px] text-ink">
            You are offline. Marks are saved on this phone and sync when you reconnect.
          </p>
        )}
        {error && (
          <div className="px-5 pt-4">
            <ErrorNote message={error} />
          </div>
        )}
        {people.length === 0 ? (
          <EmptyState title="Nobody enrolled" />
        ) : (
          <ul className="divide-y divide-line">
            {people.map((p) => {
              const q = queued.get(p.candidateId);
              return (
                <li key={p.candidateId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  {/* On a phone the name keeps its own line and the four buttons go full width below it. */}
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-[13px] text-muted">
                      {p.code}
                      {p.locked && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Lock className="size-3.5" aria-hidden />
                          Results submitted, locked
                        </span>
                      )}
                      {q?.state === 'pending' && !draft[p.candidateId] && (
                        <span className="ml-2 inline-flex items-center gap-1 font-medium text-warning">
                          <Clock className="size-3.5" aria-hidden />
                          Waiting to sync
                        </span>
                      )}
                      {q && q.state !== 'pending' && (
                        <Link to="/partner/sync" className="ml-2 inline-flex items-center gap-1 font-medium text-brand underline">
                          <AlertTriangle className="size-3.5" aria-hidden />
                          {q.state === 'conflict' ? 'Needs your choice' : 'Not saved'}
                        </Link>
                      )}
                    </p>
                  </div>
                  <div role="group" aria-label={`Attendance for ${p.name}`} className="grid w-full grid-cols-4 gap-1.5 sm:w-auto">
                    {ATTENDANCE_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={shown(p.candidateId) === s}
                        disabled={p.locked}
                        onClick={() => setDraft({ ...draft, [p.candidateId]: s })}
                        className={`h-10 min-w-0 rounded-lg sm:h-9 sm:min-w-[72px] border border-line bg-white px-2 text-[13px] font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-70 disabled:hover:bg-white ${BUTTON[s]}`}
                      >
                        {ATTENDANCE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {people.length > 0 && (
          <div className="sticky bottom-16 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-5 py-3 lg:bottom-0">
            <span className="text-sm text-muted" aria-live="polite">
              {changed.length ? `${plural(changed.length, 'change')} not saved` : waiting ? `Saved on this phone, ${waiting} waiting to sync` : 'All saved'}
              {unmarked ? `, ${unmarked} not marked` : ''}
              {problems ? `, ${problems} need attention` : ''}
            </span>
            <button className="btn-primary" disabled={saving || changed.length === 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        )}
      </section>

      <aside className="card h-fit overflow-hidden">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Sessions held ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No attendance recorded yet.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
            {sessions.map(([d, attended]) => (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => {
                    setDate(d);
                    setDraft({});
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface/60 ${d === effectiveDate ? 'bg-brand-tint' : ''}`}
                >
                  <span>{longDate(d)}</span>
                  <span className="text-[13px] text-muted">{attended}/{people.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
          <Link to="/partner/sync" className="font-medium text-brand underline">Sync status</Link>
          {off.meta.lastSyncAt ? `: last synced ${new Date(off.meta.lastSyncAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
      </aside>
    </div>
  );
}
