import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, type AttendanceStatus } from '@vta/shared';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Spinner } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';

interface AttendanceDay {
  today: string;
  canRecord: boolean;
  window: { from: string; to: string };
  sessions: { date: string; present: number; late: number; absent: number; excused: number }[];
  marks?: { candidateId: string; status: AttendanceStatus }[];
}
interface Person {
  candidateId: string;
  name: string;
  code: string;
  status: string;
}

const BUTTON: Record<AttendanceStatus, string> = {
  present: 'aria-pressed:bg-success aria-pressed:text-white aria-pressed:border-success',
  late: 'aria-pressed:bg-warning aria-pressed:text-white aria-pressed:border-warning',
  absent: 'aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand',
  excused: 'aria-pressed:bg-ink aria-pressed:text-white aria-pressed:border-ink',
};

const longDate = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));

/** R-02: the trainer marks each enrolled candidate for a date; everyone else sees a read-only view. */
export function AttendanceTab({ batchId, people, batchStatus }: { batchId: string; people: Person[]; batchStatus: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const enrolled = useMemo(() => people.filter((p) => p.status === 'enrolled' || p.status === 'completed' || p.status === 'not_completed'), [people]);

  const meta = useQuery({ queryKey: ['attendance', batchId, 'meta'], queryFn: () => api.get<AttendanceDay>(`/batches/${batchId}/attendance`) });
  const effectiveDate = date || meta.data?.window.to || '';
  const day = useQuery({
    queryKey: ['attendance', batchId, effectiveDate],
    enabled: !!effectiveDate,
    queryFn: () => api.get<AttendanceDay>(`/batches/${batchId}/attendance${qs({ date: effectiveDate })}`),
  });

  useEffect(() => {
    if (!day.data?.marks) return;
    setDraft(Object.fromEntries(day.data.marks.map((m) => [m.candidateId, m.status])));
    setError('');
  }, [day.data]);

  if (meta.isLoading) return <Spinner />;
  if (meta.isError) return <ErrorNote message={(meta.error as Error).message} />;
  const m = meta.data!;
  const canRecord = m.canRecord;
  const saved = Object.fromEntries((day.data?.marks ?? []).map((x) => [x.candidateId, x.status]));
  const changed = enrolled.filter((p) => draft[p.candidateId] && draft[p.candidateId] !== saved[p.candidateId]);
  const unmarked = enrolled.filter((p) => !draft[p.candidateId]).length;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.put<{ saved: number }>(`/batches/${batchId}/attendance`, {
        date: effectiveDate,
        marks: changed.map((p) => ({ candidateId: p.candidateId, status: draft[p.candidateId] })),
      });
      await qc.invalidateQueries({ queryKey: ['attendance', batchId] });
      await qc.invalidateQueries({ queryKey: ['batch', batchId] });
      toast('success', `Attendance saved for ${longDate(effectiveDate)} (${res.saved} ${res.saved === 1 ? 'change' : 'changes'})`);
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Attendance could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  /** Fills in only the candidates not marked yet; anyone already marked keeps their mark. */
  const markAll = (s: AttendanceStatus) => setDraft(Object.fromEntries(enrolled.map((p) => [p.candidateId, draft[p.candidateId] ?? s])));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <label htmlFor="att-date" className="field-label">Session date</label>
            <input
              id="att-date"
              type="date"
              className="field-input w-52"
              min={m.window.from}
              max={m.window.to}
              value={effectiveDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {canRecord && enrolled.length > 0 && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => markAll('present')}>
              <Check className="size-4" aria-hidden />
              Mark the rest present
            </button>
          )}
        </div>
        {!canRecord && (
          <p className="border-b border-line bg-surface/60 px-5 py-2.5 text-[13px] text-muted">
            {batchStatus === 'planned' ? 'Attendance opens when the batch starts.' : batchStatus === 'active' ? 'Only the batch trainer records attendance. You are viewing it.' : `This batch is ${batchStatus}; attendance is closed.`}
          </p>
        )}
        {error && <div className="px-5 pt-4"><ErrorNote message={error} /></div>}
        {day.isLoading ? (
          <Spinner />
        ) : enrolled.length === 0 ? (
          <EmptyState title="Nobody enrolled" />
        ) : (
          <ul className="divide-y divide-line">
            {enrolled.map((p) => (
              <li key={p.candidateId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-[13px] text-muted">{p.code}</p>
                </div>
                <div role="group" aria-label={`Attendance for ${p.name}`} className="grid grid-cols-4 gap-1.5">
                  {ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={draft[p.candidateId] === s}
                      disabled={!canRecord}
                      onClick={() => setDraft({ ...draft, [p.candidateId]: s })}
                      className={`h-9 min-w-[72px] rounded-lg border border-line bg-white px-2 text-[13px] font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-default disabled:hover:bg-white ${BUTTON[s]}`}
                    >
                      {ATTENDANCE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canRecord && enrolled.length > 0 && (
          <div className="sticky bottom-16 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-5 py-3 lg:bottom-0">
            <span className="text-sm text-muted">
              {changed.length ? `${changed.length} ${changed.length === 1 ? 'change' : 'changes'} not saved` : 'All saved'}
              {unmarked ? `, ${unmarked} not marked` : ''}
            </span>
            <button className="btn-primary" disabled={saving || changed.length === 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        )}
      </section>

      <aside className="card h-fit overflow-hidden">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Sessions held ({m.sessions.length})</h3>
        {m.sessions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No attendance recorded yet.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
            {m.sessions.map((s) => (
              <li key={s.date}>
                <button type="button" onClick={() => setDate(s.date)} className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface/60 ${s.date === effectiveDate ? 'bg-brand-tint' : ''}`}>
                  <span>{longDate(s.date)}</span>
                  <span className="text-[13px] text-muted">{s.present + s.late}/{s.present + s.late + s.absent}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
