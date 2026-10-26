import { useQuery, useQueryClient } from '@tanstack/react-query';
import { APPLICATION_STATUS_LABEL, applySchema, INTERVIEW_MODE_LABEL, SKILL_AREAS, type ApplicationStatus, type Page } from '@vta/shared';
import { ArrowLeft, Award, Briefcase, CalendarClock, Check, MailOpen, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, formatPhone, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useForm } from '../../lib/useForm';
import { dateTime, experienceText, salaryText, shortDate, skillLabel, type JobView } from '../hiring/format';

type LearnerJob = JobView & { employer: string; myApplicationId: string | null };
interface JobList extends Page<LearnerJob> {
  invitations: { jobId: string; title: string; employer: string; message: string | null; at: string }[];
}

/** EE-07: open jobs from VTA-verified employers, with filters, and any invitations to apply. */
export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const f = { q: params.get('q') ?? '', skillArea: params.get('skillArea') ?? '', city: params.get('city') ?? '', page: params.get('page') ?? '1' };
  const q = useQuery({ queryKey: ['me', 'jobs', f], queryFn: () => api.get<JobList>(`/jobs${qs({ ...f, pageSize: 20 })}`), placeholderData: (p) => p });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };
  return (
    <>
      <PageHeader
        title="Jobs"
        description="Jobs from employers checked by VTA."
        actions={
          <Link to="/learn/applications" className="btn-secondary">
            My applications
          </Link>
        }
      />
      {q.data && q.data.invitations.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-semibold text-muted">Invited to apply</h2>
          <ul className="mt-2 grid gap-2">
            {q.data.invitations.map((i) => (
              <li key={i.jobId}>
                <Link to={`/learn/jobs/${i.jobId}`} className="card flex items-start gap-3 border-brand px-4 py-3 hover:bg-brand-tint">
                  <MailOpen className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 text-sm">
                    <span className="block font-semibold">
                      {i.employer} invited you to apply: {i.title}
                    </span>
                    {i.message && <span className="block text-muted">&ldquo;{i.message}&rdquo;</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_160px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          set('q', text.trim());
        }}
      >
        <label className="sr-only" htmlFor="jq">
          Search jobs
        </label>
        <input id="jq" type="search" className="field-input" placeholder="Job title or employer" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="sr-only" htmlFor="jskill">
          Skill area
        </label>
        <select id="jskill" className="field-input" value={f.skillArea} onChange={(e) => set('skillArea', e.target.value)}>
          <option value="">All skills</option>
          {SKILL_AREAS.map((s) => (
            <option key={s} value={s}>
              {skillLabel(s)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="jcity">
          City
        </label>
        <input id="jcity" className="field-input" placeholder="City" defaultValue={f.city} onBlur={(e) => set('city', e.target.value.trim())} />
        <button type="submit" className="btn-primary">
          Search
        </button>
      </form>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <EmptyState title="No open jobs match" body="Try another skill or city, or check again later." />
      ) : (
        <>
          <ul className="grid gap-3">
            {q.data!.items.map((j) => (
              <li key={j.id}>
                <Link to={`/learn/jobs/${j.id}`} className="card block px-5 py-4 hover:border-brand">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{j.title}</p>
                      <p className="text-sm text-muted">{j.employer}</p>
                    </div>
                    {j.myApplicationId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success">
                        <Check className="size-3.5" aria-hidden />
                        Applied
                      </span>
                    )}
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5 text-muted" aria-hidden />
                      {j.city}
                    </span>
                    <span>{salaryText(j.salaryMin, j.salaryMax)}</span>
                    <span className="text-muted">Apply by {shortDate(j.closingDate)}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="card mt-3">
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => setParams(new URLSearchParams({ ...Object.fromEntries(params), page: String(p) }))} />
          </div>
        </>
      )}
    </>
  );
}

interface JobDetail extends LearnerJob {
  share: {
    fields: string[];
    contact: { name: string; phone: string | null; email: string | null };
    certificates: { id: string; course: string }[];
    documents: { id: string; title: string }[];
    verificationStatus: string;
  };
}

/** EE-07 / EE-08: the job, and applying after seeing exactly what will be shared. */
export function JobDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['me', 'job', id], queryFn: () => api.get<JobDetail>(`/jobs/${id}`) });
  const [applying, setApplying] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const j = q.data!;
  return (
    <>
      <Link to="/learn/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Jobs
      </Link>
      <header className="mb-5 mt-3">
        <h1 className="text-[26px] font-bold tracking-tight">{j.title}</h1>
        <p className="mt-1 text-muted">{j.employer}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="card px-5 py-5">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <MapPin className="size-4 text-muted" aria-hidden />
              {j.city}
              {j.location ? `, ${j.location}` : ''}
            </li>
            <li className="flex items-center gap-2">
              <Briefcase className="size-4 text-muted" aria-hidden />
              {skillLabel(j.skillArea)}, {j.openings} openings
            </li>
            <li className="font-semibold">{salaryText(j.salaryMin, j.salaryMax)}</li>
            <li>{experienceText(j.minExperienceMonths)}</li>
            {j.shift && <li className="sm:col-span-2">{j.shift}</li>}
          </ul>
          {j.skills.length > 0 && (
            <p className="mt-4 text-sm">
              <span className="font-semibold">Skills needed:</span> {j.skills.join(', ')}
            </p>
          )}
          {j.vtaCertificatePreferred && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand">
              <Award className="size-4" aria-hidden />
              VTA certificate preferred
            </p>
          )}
          <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-[15px] leading-relaxed">{j.description}</p>
        </section>
        <aside className="card h-fit px-5 py-5">
          <p className="text-sm text-muted">Apply by {shortDate(j.closingDate)}</p>
          {j.myApplicationId ? (
            <>
              <p className="mt-3 font-semibold">You have applied</p>
              <Link to={`/learn/applications/${j.myApplicationId}`} className="btn-secondary mt-3 w-full">
                See my application
              </Link>
            </>
          ) : (
            <button className="btn-primary mt-3 h-11 w-full" onClick={() => setApplying(true)}>
              Apply
            </button>
          )}
          <p className="mt-3 text-[13px] text-muted">VTA checks employers but does not promise a job. The employer decides who to hire.</p>
        </aside>
      </div>
      {applying && <ApplyModal job={j} onClose={() => setApplying(false)} />}
    </>
  );
}

function ApplyModal({ job, onClose }: { job: JobDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const f = useForm(applySchema);
  const [share, setShare] = useState(false);
  const [note, setNote] = useState('');
  const s = job.share;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Apply: ${job.title}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={f.submitting}
            onClick={() =>
              void f.submit({ shareProfile: share, note }, async (data) => {
                try {
                  const res = await api.post<{ id: string }>(`/jobs/${job.id}/apply`, data);
                  await qc.invalidateQueries({ queryKey: ['me'] });
                  toast('success', `Applied to ${job.employer}`);
                  navigate(`/learn/applications/${res.id}`);
                } catch (e) {
                  if (e instanceof ApiError && e.status === 409) {
                    await qc.invalidateQueries({ queryKey: ['me', 'job', job.id] });
                    onClose();
                  }
                  throw e;
                }
              })
            }
          >
            {f.submitting ? 'Sending…' : 'Send application'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {f.formError && <ErrorNote message={f.formError} />}
        <p>
          <span className="font-semibold">{job.employer}</span> will see:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          {s.fields.map((x) => (
            <li key={x}>{x}</li>
          ))}
          {s.certificates.length > 0 && <li>Your VTA certificates: {s.certificates.map((c) => c.course).join(', ')}</li>}
          {s.documents.length > 0 && <li>Documents you marked for employers: {s.documents.map((d) => d.title).join(', ')}</li>}
        </ul>
        <p className="rounded-lg bg-surface px-3 py-2">
          {s.contact.name}, {formatPhone(s.contact.phone)}
          {s.contact.email ? `, ${s.contact.email}` : ''}
        </p>
        {s.verificationStatus !== 'verified' && <p className="text-warning">Your profile is not verified by VTA yet. The employer will see that.</p>}
        <div>
          <label htmlFor="ap-note" className="field-label">
            Message to the employer (optional)
          </label>
          <textarea id="ap-note" rows={2} maxLength={500} className="field-input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="flex items-start gap-3 font-medium">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={share} onChange={(e) => setShare(e.target.checked)} />
          Share my profile with {job.employer} for this job
        </label>
        {f.errors.shareProfile && (
          <p className="field-error" role="alert">
            {f.errors.shareProfile}
          </p>
        )}
        <p className="text-[13px] text-muted">If you withdraw later, the employer stops seeing your contact details and documents.</p>
      </div>
    </Modal>
  );
}

interface MyApplication {
  id: string;
  status: ApplicationStatus;
  appliedAt: string;
  updatedAt: string;
  joiningDate: string | null;
  job: { id: string; title: string; city: string; employer: string };
}

/** EE-09: the person's applications and where each stands. */
export function ApplicationsPage() {
  const q = useQuery({ queryKey: ['me', 'applications'], queryFn: () => api.get<{ items: MyApplication[] }>('/me/applications') });
  return (
    <>
      <PageHeader title="My applications" />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <EmptyState
          title="No applications yet"
          body="When you apply to a job, you can follow it here."
          action={
            <Link to="/learn/jobs" className="btn-primary">
              Find jobs
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {q.data!.items.map((a) => (
            <li key={a.id}>
              <Link to={`/learn/applications/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.job.title}</span>
                  <span className="block text-sm text-muted">
                    {a.job.employer}, {a.job.city}. Applied {shortDate(a.appliedAt)}
                  </span>
                </span>
                <StatusBadge status={a.status} label={APPLICATION_STATUS_LABEL[a.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface MyApplicationDetail {
  id: string;
  status: ApplicationStatus;
  appliedAt: string;
  joiningDate: string | null;
  note: string | null;
  job: { id: string; title: string; city: string; employer: string };
  shared: { sharedAt: string; fields: string[]; certificates: { course: string }[]; documents: { title: string }[] };
  timeline: { id: string; status: ApplicationStatus; at: string }[];
  interviews: { id: string; scheduledAt: string; mode: keyof typeof INTERVIEW_MODE_LABEL; location: string | null }[];
  canWithdraw: boolean;
}

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ['me', 'application', id], queryFn: () => api.get<MyApplicationDetail>(`/me/applications/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const a = q.data!;
  return (
    <>
      <Link to="/learn/applications" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        My applications
      </Link>
      <header className="mb-5 mt-3">
        <h1 className="text-[26px] font-bold tracking-tight">{a.job.title}</h1>
        <p className="mt-1 text-muted">
          {a.job.employer}, {a.job.city}
        </p>
        <div className="mt-2">
          <StatusBadge status={a.status} label={APPLICATION_STATUS_LABEL[a.status]} />
        </div>
      </header>
      {a.status === 'joined' && a.joiningDate && <p className="mb-4 rounded-lg bg-success-tint px-4 py-3 text-sm text-success">Congratulations! The employer recorded that you joined on {shortDate(a.joiningDate)}.</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {a.interviews.length > 0 && (
            <section className="card px-5 py-4">
              <h2 className="font-semibold">Interview</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {a.interviews.map((i) => (
                  <li key={i.id} className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 size-4 text-brand" aria-hidden />
                    <span>
                      <span className="block font-semibold">{dateTime(i.scheduledAt)}</span>
                      {INTERVIEW_MODE_LABEL[i.mode]}
                      {i.location ? `, ${i.location}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card px-5 py-4">
            <h2 className="font-semibold">Progress</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {a.timeline.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{APPLICATION_STATUS_LABEL[e.status]}</span>
                  <span className="text-muted">{dateTime(e.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="card px-5 py-4 text-sm">
            <h2 className="font-semibold">What you shared</h2>
            <p className="mt-1 text-muted">On {shortDate(a.shared.sharedAt)}:</p>
            <ul className="ml-5 mt-1 list-disc space-y-0.5">
              {a.shared.fields.map((x) => (
                <li key={x}>{x}</li>
              ))}
              {a.shared.certificates.length > 0 && <li>VTA certificates</li>}
              {a.shared.documents.length > 0 && <li>{a.shared.documents.length} documents</li>}
            </ul>
          </section>
          {a.canWithdraw && (
            <button className="btn-secondary w-full" onClick={() => setConfirm(true)}>
              Withdraw application
            </button>
          )}
        </aside>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Withdraw application?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await api.post(`/me/applications/${id}/withdraw`);
                await qc.invalidateQueries({ queryKey: ['me'] });
                setConfirm(false);
                toast('success', 'Application withdrawn');
              }}
            >
              Withdraw
            </button>
          </>
        }
      >
        <p>{a.job.employer} will no longer see your contact details or documents for this job.</p>
      </Modal>
    </>
  );
}
