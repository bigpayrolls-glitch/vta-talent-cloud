import { useQuery, useQueryClient } from '@tanstack/react-query';
import { batchSchema, BATCH_STATUSES, type Page } from '@vta/shared';
import { ArrowLeft, Award, CalendarDays, MapPin, Plus, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AssessmentsTab, ResultChip } from '../operations/AssessmentsTab';
import { AttendanceTab } from '../operations/AttendanceTab';
import { dateRange, SearchBox, Select, SkillTags } from '../../components/form';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, formatDate, formatPhone, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { useListParams } from '../../lib/useListParams';
import { ReasonModal } from './Trainers';

interface BatchRow {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  capacity: number;
  enrolled: number;
  course: { id: string; title: string; skillArea: string };
  centre: { id: string; name: string; city: string | null };
  trainer: { id: string; name: string };
}
interface BatchDetail extends BatchRow {
  cancelReason: string | null;
  canManage: boolean;
}
interface RosterRow {
  enrolmentId: string;
  status: string;
  enrolledAt: string;
  withdrawReason: string | null;
  candidateId: string;
  code: string;
  name: string;
  verificationStatus: string;
  phone?: string;
  attendance: { pct: number | null; present: number; late: number; absent: number; excused: number; unmarked: number };
  belowThreshold: boolean;
  assessmentStatus: string;
  assessmentOutcome: 'pass' | 'fail' | null;
  credentialId: string | null;
}
interface RosterResponse {
  showContact: boolean;
  sessionsHeld: number;
  thresholdPct: number;
  items: RosterRow[];
}

const STATUS_LABEL: Record<string, string> = { planned: 'Planned', active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };

/** Batch list, used by the Admin Portal (base /admin/batches) and the Training Partner Portal (base /partner/batches). */
export function BatchesPage({ base }: { base: string }) {
  const { can } = useAuth();
  const { values, page, set, setPage } = useListParams(['q', 'status'] as const);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['batches', values, page],
    queryFn: () => api.get<Page<BatchRow>>(`/batches${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  const admin = base.startsWith('/admin');

  return (
    <div>
      <PageHeader
        title={admin ? 'Batches' : 'My batches'}
        description={admin ? 'Training batches: course, centre, trainer, dates and who is enrolled.' : 'Batches at your centres. Attendance and assessments arrive in the next phase.'}
        actions={
          admin &&
          can('batch.manage') && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Create batch
            </button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by batch or course" label="Search batches" />
        <Select id="b-status" label="Status" className="sm:w-44" value={values.status} onChange={(v) => set('status', v)} options={[{ value: '', label: 'Any status' }, ...BATCH_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s]! }))]} />
      </div>

      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : q.data!.items.length === 0 ? (
        <div className="card">
          <EmptyState title="No batches here yet" body={admin ? 'Create a batch from a course, a centre and a verified trainer.' : 'Batches assigned to you or your centres will appear here.'} />
        </div>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data!.items.map((b) => (
              <li key={b.id}>
                <Link to={`${base}/${b.id}`} className="card block h-full px-5 py-4 transition-colors hover:border-brand">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-semibold">{b.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                        <SkillTags areas={[b.course.skillArea]} />
                        {b.course.title}
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </span>
                  <span className="mt-3 grid gap-1 text-sm text-muted">
                    <span className="flex items-center gap-2"><CalendarDays className="size-4" aria-hidden />{dateRange(b.startDate, b.endDate)}</span>
                    <span className="flex items-center gap-2"><MapPin className="size-4" aria-hidden />{b.centre.name}</span>
                    <span className="flex items-center gap-2"><UserRound className="size-4" aria-hidden />{b.trainer.name}</span>
                  </span>
                  <CapacityBar enrolled={b.enrolled} capacity={b.capacity} />
                </Link>
              </li>
            ))}
          </ul>
          <div className="card mt-3">
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </div>
        </>
      )}
      {creating && <CreateBatchModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CapacityBar({ enrolled, capacity }: { enrolled: number; capacity: number }) {
  const pct = Math.min(100, Math.round((enrolled / capacity) * 100));
  return (
    <span className="mt-3 block">
      <span className="flex justify-between text-[13px]">
        <span className="font-medium">{enrolled} of {capacity} enrolled</span>
        <span className="text-muted">{capacity - enrolled} {capacity - enrolled === 1 ? 'place' : 'places'} left</span>
      </span>
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
        <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function CreateBatchModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const f = useForm(batchSchema);
  const [v, setV] = useState({ name: '', courseId: '', centreId: '', trainerId: '', startDate: '', endDate: '', capacity: '20' });
  const courses = useQuery({ queryKey: ['course-options'], queryFn: () => api.get<Page<{ id: string; title: string; code: string | null }>>(`/courses${qs({ status: 'active', pageSize: 100 })}`) });
  const centres = useQuery({ queryKey: ['centre-options'], queryFn: () => api.get<Page<{ id: string; name: string; city: string | null; organisationName: string | null }>>(`/centres${qs({ status: 'active', pageSize: 100 })}`) });
  const trainers = useQuery({
    queryKey: ['trainer-options', v.centreId],
    enabled: !!v.centreId,
    queryFn: () => api.get<Page<{ id: string; name: string; specialisations: string[] }>>(`/trainers${qs({ centreId: v.centreId, verificationStatus: 'verified', pageSize: 100 })}`),
  });
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value, ...(k === 'centreId' && { trainerId: '' }) });

  return (
    <Modal
      open
      onClose={onClose}
      title="Create batch"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="batch-form" disabled={f.submitting}>Create batch</button>
        </>
      }
    >
      <form
        id="batch-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(v, async (data) => {
            const r = await api.post<{ id: string }>('/admin/batches', data);
            await qc.invalidateQueries({ queryKey: ['batches'] });
            await qc.invalidateQueries({ queryKey: ['dashboard'] });
            toast('success', 'Batch created');
            navigate(`/admin/batches/${r.id}`);
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Batch name" htmlFor="bf-name" error={f.errors.name}>
          <input id="bf-name" autoFocus className="field-input" placeholder="For example, 2W Peenya January 2027" value={v.name} onChange={upd('name')} />
        </Field>
        <Field label="Course" htmlFor="bf-course" error={f.errors.courseId}>
          <select id="bf-course" className="field-input" value={v.courseId} onChange={upd('courseId')}>
            <option value="">Choose a course</option>
            {courses.data?.items.map((c) => <option key={c.id} value={c.id}>{c.title}{c.code ? ` (${c.code})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Centre" htmlFor="bf-centre" error={f.errors.centreId}>
          <select id="bf-centre" className="field-input" value={v.centreId} onChange={upd('centreId')}>
            <option value="">Choose a centre</option>
            {centres.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''} ({c.organisationName ?? 'VTA'})</option>)}
          </select>
        </Field>
        <Field label="Trainer" htmlFor="bf-trainer" error={f.errors.trainerId} hint={v.centreId ? 'Verified trainers at this centre.' : 'Choose a centre first.'}>
          <select id="bf-trainer" className="field-input" value={v.trainerId} onChange={upd('trainerId')} disabled={!v.centreId}>
            <option value="">{v.centreId && trainers.data?.items.length === 0 ? 'No verified trainers at this centre' : 'Choose a trainer'}</option>
            {trainers.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}{t.specialisations.length ? ` (${t.specialisations.join(', ')})` : ''}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" htmlFor="bf-start" error={f.errors.startDate}>
            <input id="bf-start" type="date" className="field-input" value={v.startDate} onChange={upd('startDate')} />
          </Field>
          <Field label="End date" htmlFor="bf-end" error={f.errors.endDate}>
            <input id="bf-end" type="date" className="field-input" value={v.endDate} onChange={upd('endDate')} />
          </Field>
        </div>
        <Field label="Capacity" htmlFor="bf-cap" error={f.errors.capacity}>
          <input id="bf-cap" type="number" min={1} max={500} className="field-input" value={v.capacity} onChange={upd('capacity')} />
        </Field>
      </form>
    </Modal>
  );
}

export function BatchDetailPage({ base }: { base: string }) {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [withdrawing, setWithdrawing] = useState<RosterRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [issued, setIssued] = useState<{ issuedTo: string[]; skipped: { name: string; reason: string }[] } | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'roster') as 'roster' | 'attendance' | 'assessments';
  const batch = useQuery({ queryKey: ['batch', id], queryFn: () => api.get<BatchDetail>(`/batches/${id}`) });
  const roster = useQuery({
    queryKey: ['batch', id, 'roster', search],
    queryFn: () => api.get<RosterResponse>(`/batches/${id}/roster${qs({ q: search })}`),
    placeholderData: (p) => p,
  });
  if (batch.isLoading) return <Spinner />;
  if (batch.isError) return <ErrorNote message={(batch.error as Error).message} />;
  const b = batch.data!;
  const open = b.status === 'planned' || b.status === 'active';
  const manage = b.canManage && base.startsWith('/admin');
  const candidateLinks = can('candidate.read') && base.startsWith('/admin');
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['batch'] });
    await qc.invalidateQueries({ queryKey: ['batches'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const move = async (path: 'start' | 'complete', done: string) => {
    try {
      const r = await api.post<{ completion?: { completed: number; notCompleted: number } }>(`/admin/batches/${b.id}/${path}`);
      await refresh();
      toast('success', r.completion ? `${done}: ${r.completion.completed} completed, ${r.completion.notCompleted} below the attendance needed` : done);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const issueCertificates = async () => {
    try {
      const r = await api.post<{ issuedTo: string[]; skipped: { name: string; reason: string }[] }>(`/admin/batches/${b.id}/credentials`);
      await refresh();
      setIssued(r);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const setTab = (t: string) => {
    const n = new URLSearchParams(params);
    if (t === 'roster') n.delete('tab');
    else n.set('tab', t);
    setParams(n, { replace: true });
  };
  const atRisk = roster.data?.items.filter((r) => r.belowThreshold).length ?? 0;
  const people = (roster.data?.items ?? []).map((r) => ({ candidateId: r.candidateId, name: r.name, code: r.code, status: r.status }));

  return (
    <div>
      <Link to={base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All batches
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{b.name}</h1>
            <StatusBadge status={b.status} />
          </div>
          <p className="mt-1 text-muted">{b.course.title}</p>
          {b.cancelReason && <p className="mt-1 text-sm text-muted">Cancelled: {b.cancelReason}</p>}
        </div>
        {base.startsWith('/admin') && b.status === 'completed' && can('credential.issue') && (
          <button className="btn-primary" onClick={() => void issueCertificates()}>
            <Award className="size-4" aria-hidden />
            Issue certificates
          </button>
        )}
        {manage && open && (
          <div className="flex flex-wrap gap-2">
            {b.status === 'planned' && <button className="btn-primary" onClick={() => void move('start', 'Batch started')}>Start batch</button>}
            {b.status === 'active' && <button className="btn-primary" onClick={() => void move('complete', 'Batch completed')}>Mark completed</button>}
            <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn-secondary text-brand" onClick={() => setCancelling(true)}>Cancel batch</button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={CalendarDays} label="Dates" value={dateRange(b.startDate, b.endDate)} />
        <Fact icon={MapPin} label="Centre" value={`${b.centre.name}${b.centre.city ? `, ${b.centre.city}` : ''}`} />
        <Fact icon={UserRound} label="Trainer" value={b.trainer.name} />
        <div className="card px-4 py-3.5">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Users className="size-4" aria-hidden />Enrolment</p>
          <CapacityBar enrolled={b.enrolled} capacity={b.capacity} />
        </div>
      </div>

      <div role="tablist" aria-label="Batch sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {([
          ['roster', 'Roster'],
          ['attendance', 'Attendance'],
          ['assessments', 'Assessments'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
            {key === 'roster' && atRisk > 0 && <span className="ml-2 rounded-full bg-warning-tint px-1.5 py-0.5 text-xs text-warning">{atRisk} at risk</span>}
          </button>
        ))}
      </div>

      {tab === 'attendance' && <div className="mt-4"><AttendanceTab batchId={b.id} people={people} batchStatus={b.status} /></div>}
      {tab === 'assessments' && <div className="mt-4"><AssessmentsTab batchId={b.id} /></div>}

      {tab === 'roster' && (
      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-semibold">Roster</h2>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <div className="w-full sm:w-72">
              <SearchBox initial={search} onSearch={setSearch} placeholder="Search name or candidate ID" label="Search roster" />
            </div>
            {manage && open && (
              <button className="btn-primary" onClick={() => setEnrolling(true)} disabled={b.enrolled >= b.capacity} title={b.enrolled >= b.capacity ? 'This batch is full' : undefined}>
                <Plus className="size-4" aria-hidden />
                Enrol candidates
              </button>
            )}
          </div>
        </div>
        {roster.isLoading ? (
          <Spinner />
        ) : !roster.data || roster.data.items.length === 0 ? (
          <EmptyState title={search ? 'Nobody matches that search' : 'Nobody enrolled yet'} />
        ) : (
          <ul className="divide-y divide-line">
            {roster.data.items.map((r) => (
              <li key={r.enrolmentId} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 ${r.status === 'withdrawn' ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  {candidateLinks ? (
                    <Link to={`/admin/candidates/${r.candidateId}`} className="font-medium hover:text-brand">{r.name}</Link>
                  ) : (
                    <p className="font-medium">{r.name}</p>
                  )}
                  <p className="text-[13px] text-muted">
                    {r.code}
                    {r.phone && `, ${formatPhone(r.phone)}`}
                    {r.status === 'withdrawn' && r.withdrawReason ? `. Withdrawn: ${r.withdrawReason}` : `. Enrolled ${formatDate(r.enrolledAt)}`}
                  </p>
                </div>
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  {r.attendance.pct !== null && (
                    <span className={`rounded-md px-1.5 py-0.5 font-semibold ${r.belowThreshold ? 'bg-warning-tint text-warning' : 'bg-surface text-ink'}`} title="Attendance so far">
                      {r.attendance.pct}%{r.belowThreshold ? ' below needed' : ''}
                    </span>
                  )}
                  {r.assessmentStatus !== 'not_started' && <ResultChip status={r.assessmentStatus} outcome={r.assessmentOutcome} />}
                  {r.credentialId &&
                    (base.startsWith('/admin') && can('credential.read') ? (
                      <Link to={`/admin/credentials/${r.credentialId}`} className="inline-flex items-center gap-1 font-semibold text-success hover:underline">
                        <Award className="size-3.5" aria-hidden />
                        Certificate
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-success"><Award className="size-3.5" aria-hidden />Certificate</span>
                    ))}
                </span>
                <StatusBadge status={r.status} />
                {manage && open && r.status === 'enrolled' && (
                  <button className="btn-secondary btn-sm" onClick={() => setWithdrawing(r)}>Withdraw</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {roster.data && !roster.data.showContact && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Contact details are shown to the batch trainer and VTA staff only.</p>}
        {roster.data && roster.data.sessionsHeld > 0 && (
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Attendance over {roster.data.sessionsHeld} {roster.data.sessionsHeld === 1 ? 'session' : 'sessions'} so far. {roster.data.thresholdPct}% is needed to complete the course; excused sessions are not counted.
          </p>
        )}
      </section>
      )}

      {enrolling && <EnrolModal batch={b} onClose={() => setEnrolling(false)} onDone={refresh} />}
      {issued && (
        <Modal open onClose={() => setIssued(null)} title="Certificates" footer={<button className="btn-primary" onClick={() => setIssued(null)}>Done</button>}>
          <div className="space-y-4 text-sm">
            <p className="font-semibold">{issued.issuedTo.length === 0 ? 'No new certificates issued.' : `${issued.issuedTo.length} issued: ${issued.issuedTo.join(', ')}.`}</p>
            {issued.skipped.length > 0 && (
              <div>
                <p className="font-medium">Not issued</p>
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                  {issued.skipped.map((x) => (
                    <li key={x.name} className="flex justify-between gap-3 px-3 py-2">
                      <span>{x.name}</span>
                      <span className="text-right text-muted">{x.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[13px] text-muted">A certificate needs all three: attendance to complete the course, an approved assessment, and a pass.</p>
          </div>
        </Modal>
      )}
      {editing && <EditBatchModal batch={b} onClose={() => setEditing(false)} onDone={refresh} />}
      {withdrawing && (
        <ReasonModal
          title={`Withdraw ${withdrawing.name}?`}
          label="Reason for withdrawal"
          action="Withdraw"
          intro="Their place becomes free. They can be enrolled again later."
          onClose={() => setWithdrawing(null)}
          onSubmit={(reason) => api.post(`/admin/enrolments/${withdrawing.enrolmentId}/withdraw`, { reason }).then(refresh).then(() => toast('success', 'Candidate withdrawn'))}
        />
      )}
      {cancelling && (
        <ReasonModal
          title={`Cancel ${b.name}?`}
          label="Why is the batch cancelled?"
          action="Cancel batch"
          intro="A cancelled batch cannot be restarted. Enrolments are kept for the record."
          onClose={() => setCancelling(false)}
          onSubmit={(reason) => api.post(`/admin/batches/${b.id}/cancel`, { reason }).then(refresh).then(() => toast('success', 'Batch cancelled'))}
        />
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13px] text-muted"><Icon className="size-4" aria-hidden />{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function EnrolModal({ batch, onClose, onDone }: { batch: BatchDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const free = batch.capacity - batch.enrolled;
  const options = useQuery({
    queryKey: ['candidate-options', batch.id, q],
    queryFn: () => api.get<{ items: { id: string; name: string; code: string; city: string; verificationStatus: string }[] }>(`/admin/batches/${batch.id}/candidate-options${qs({ q })}`),
    placeholderData: (p) => p,
  });
  const count = Object.keys(picked).length;
  const toggle = (id: string, name: string) => setPicked((p) => (p[id] ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)) : { ...p, [id]: name }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/admin/batches/${batch.id}/enrolments`, { candidateIds: Object.keys(picked) });
      await onDone();
      toast('success', `${count} ${count === 1 ? 'candidate' : 'candidates'} enrolled`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Enrolment failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Enrol candidates"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">{count} selected, {free} {free === 1 ? 'place' : 'places'} left</span>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || count === 0 || count > free} onClick={() => void submit()}>
            {count > free ? 'Too many selected' : `Enrol ${count || ''}`.trim()}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <SearchBox initial="" onSearch={setQ} placeholder="Search name or candidate ID" label="Search candidates to enrol" />
        <p className="text-[13px] text-muted">Pending and verified candidates who are not already in this batch.</p>
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {options.data?.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No matching candidates</li>}
          {options.data?.items.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface/60">
                <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={!!picked[c.id]} onChange={() => toggle(c.id, c.name)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-[13px] text-muted">{c.code}, {c.city}</span>
                </span>
                <StatusBadge status={c.verificationStatus} />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function EditBatchModal({ batch, onClose, onDone }: { batch: BatchDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [v, setV] = useState({ name: batch.name, trainerId: batch.trainer.id, startDate: batch.startDate, endDate: batch.endDate, capacity: String(batch.capacity) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const trainers = useQuery({
    queryKey: ['trainer-options', batch.centre.id],
    queryFn: () => api.get<Page<{ id: string; name: string }>>(`/trainers${qs({ centreId: batch.centre.id, verificationStatus: 'verified', pageSize: 100 })}`),
  });
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    setFormError('');
    try {
      await api.patch(`/admin/batches/${batch.id}`, { ...v, capacity: Number(v.capacity) });
      await onDone();
      toast('success', 'Batch updated');
      onClose();
    } catch (e) {
      const x = e as ApiError;
      setErrors(x.fields ?? {});
      setFormError(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit batch"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>Save changes</button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <ErrorNote message={formError} />}
        <Field label="Batch name" htmlFor="eb-name" error={errors.name}>
          <input id="eb-name" className="field-input" value={v.name} onChange={upd('name')} />
        </Field>
        <Field label="Trainer" htmlFor="eb-trainer" error={errors.trainerId}>
          <select id="eb-trainer" className="field-input" value={v.trainerId} onChange={upd('trainerId')}>
            {!trainers.data?.items.some((t) => t.id === batch.trainer.id) && <option value={batch.trainer.id}>{batch.trainer.name}</option>}
            {trainers.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" htmlFor="eb-start" error={errors.startDate}>
            <input id="eb-start" type="date" className="field-input" value={v.startDate} onChange={upd('startDate')} />
          </Field>
          <Field label="End date" htmlFor="eb-end" error={errors.endDate}>
            <input id="eb-end" type="date" className="field-input" value={v.endDate} onChange={upd('endDate')} />
          </Field>
        </div>
        <Field label="Capacity" htmlFor="eb-cap" error={errors.capacity} hint={`${batch.enrolled} enrolled now`}>
          <input id="eb-cap" type="number" min={1} max={500} className="field-input" value={v.capacity} onChange={upd('capacity')} />
        </Field>
      </div>
    </Modal>
  );
}
