import { useQuery } from '@tanstack/react-query';
import { ATTENDANCE_LABEL, type AttendanceStatus } from '@vta/shared';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorNote, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { AttendanceRecorder, longDate } from './AttendanceRecorder';

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

const CHIP: Record<AttendanceStatus, string> = {
  present: 'bg-success-tint text-success',
  late: 'bg-warning-tint text-warning',
  absent: 'bg-brand-tint text-brand',
  excused: 'bg-surface text-ink',
};

/**
 * R-02: the batch trainer records attendance (saved on the phone first, so it also works offline);
 * everyone else who can see the batch gets a read-only view.
 */
export function AttendanceTab({ batchId, people, batchStatus }: { batchId: string; people: Person[]; batchStatus: string }) {
  const [date, setDate] = useState('');
  const enrolled = useMemo(() => people.filter((p) => p.status === 'enrolled' || p.status === 'completed' || p.status === 'not_completed'), [people]);

  const meta = useQuery({ queryKey: ['attendance', batchId, 'meta'], queryFn: () => api.get<AttendanceDay>(`/batches/${batchId}/attendance`) });
  const effectiveDate = date || meta.data?.window.to || '';
  const day = useQuery({
    queryKey: ['attendance', batchId, effectiveDate],
    enabled: !!effectiveDate && meta.data?.canRecord === false,
    queryFn: () => api.get<AttendanceDay>(`/batches/${batchId}/attendance${qs({ date: effectiveDate })}`),
  });

  if (meta.isLoading) return <Spinner />;
  if (meta.isError) return <ErrorNote message={(meta.error as Error).message} />;
  const m = meta.data!;
  if (m.canRecord) return <AttendanceRecorder batchId={batchId} />;

  const saved = Object.fromEntries((day.data?.marks ?? []).map((x) => [x.candidateId, x.status]));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <label htmlFor="att-date" className="field-label">Session date</label>
          <input id="att-date" type="date" className="field-input w-52" min={m.window.from} max={m.window.to} value={effectiveDate} onChange={(e) => setDate(e.target.value)} />
        </div>
        <p className="border-b border-line bg-surface/60 px-5 py-2.5 text-[13px] text-muted">
          {batchStatus === 'planned' ? 'Attendance opens when the batch starts.' : batchStatus === 'active' ? 'Only the batch trainer records attendance. You are viewing it.' : `This batch is ${batchStatus}; attendance is closed.`}
        </p>
        {day.isLoading ? (
          <Spinner />
        ) : enrolled.length === 0 ? (
          <EmptyState title="Nobody enrolled" />
        ) : (
          <ul className="divide-y divide-line">
            {enrolled.map((p) => {
              const s = saved[p.candidateId];
              return (
                <li key={p.candidateId} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-[13px] text-muted">{p.code}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${s ? CHIP[s] : 'text-muted'}`}>{s ? ATTENDANCE_LABEL[s] : 'Not marked'}</span>
                </li>
              );
            })}
          </ul>
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
