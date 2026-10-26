import { useQuery, useQueryClient } from '@tanstack/react-query';
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUSES, JOB_STATUS_LABEL, jobSchema, SKILL_AREAS, type ApplicationStatus, type JobStatus } from '@vta/shared';
import { ArrowLeft, Award, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useDraft } from '../../lib/draft';
import { useForm } from '../../lib/useForm';
import { experienceHave, experienceText, salaryText, shortDate, skillLabel, type JobView } from '../hiring/format';

const TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'pending_review', label: 'In review' },
  { key: 'draft', label: 'Drafts' },
  { key: 'paused', label: 'Paused' },
  { key: 'closed', label: 'Closed' },
];

const total = (p?: Record<string, number>) => Object.values(p ?? {}).reduce((s, n) => s + n, 0);

export function EmployerJobsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({ queryKey: ['employer', 'jobs', status], queryFn: () => api.get<{ items: JobView[] }>(`/employer/jobs${qs({ status })}`) });
  return (
    <>
      <PageHeader
        title="Jobs"
        description="AutoTalent Grid checks each job before learners see it."
        actions={
          <Link to="/employer/jobs/new" className="btn-primary">
            <Plus className="size-4" aria-hidden />
            Post a job
          </Link>
        }
      />
      <div role="tablist" aria-label="Job status" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-surface p-1">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setParams(t.key ? { status: t.key } : {})} className={`h-9 rounded-lg px-3 text-sm font-semibold ${status === t.key ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <div className="card">
          <EmptyState title="No jobs here" body="Post a job to start receiving applications." />
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {q.data!.items.map((j) => (
            <li key={j.id}>
              <Link to={`/employer/jobs/${j.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{j.title}</span>
                  <span className="block text-sm text-muted">
                    {skillLabel(j.skillArea)}, {j.city}. Closes {shortDate(j.closingDate)}. {total(j.pipeline)} applicants
                  </span>
                </span>
                <StatusBadge status={j.status!} label={JOB_STATUS_LABEL[j.status as JobStatus]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const blank = {
  title: '',
  skillArea: '2W',
  skills: '',
  minExperienceMonths: '0',
  city: '',
  location: '',
  salaryMin: '',
  salaryMax: '',
  openings: '1',
  shift: '',
  description: '',
  closingDate: '',
  vtaCertificatePreferred: false,
};

/** EM-03: post or edit a job. Unsaved input is kept on the device. */
export function JobFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const existing = useQuery({ queryKey: ['employer', 'job', id], enabled: editing, queryFn: () => api.get<JobView>(`/employer/jobs/${id}`) });
  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.isError) return <ErrorNote message={(existing.error as Error).message} />;
  const j = existing.data;
  const initial = j
    ? {
        title: j.title,
        skillArea: j.skillArea,
        skills: j.skills.join(', '),
        minExperienceMonths: String(j.minExperienceMonths),
        city: j.city,
        location: j.location ?? '',
        salaryMin: j.salaryMin == null ? '' : String(j.salaryMin),
        salaryMax: j.salaryMax == null ? '' : String(j.salaryMax),
        openings: String(j.openings),
        shift: j.shift ?? '',
        description: j.description,
        closingDate: j.closingDate,
        vtaCertificatePreferred: j.vtaCertificatePreferred,
      }
    : blank;
  return <JobForm id={id} initial={initial} status={j?.status} />;
}

function JobForm({ id, initial, status }: { id?: string; initial: typeof blank; status?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(jobSchema);
  const draft = useDraft(`job:${id ?? 'new'}`, initial);
  const v = draft.value;
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    draft.setValue({ ...v, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const save = () =>
    f.submit(
      {
        ...v,
        skills: v.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        salaryMin: v.salaryMin === '' ? null : v.salaryMin,
        salaryMax: v.salaryMax === '' ? null : v.salaryMax,
      },
      async (data) => {
        const res = id ? await api.put<JobView>(`/employer/jobs/${id}`, data) : await api.post<JobView>('/employer/jobs', data);
        draft.clear();
        await qc.invalidateQueries({ queryKey: ['employer'] });
        toast('success', id ? (res.status === 'pending_review' && status !== 'pending_review' ? 'Saved. The change goes to AutoTalent Grid for review.' : 'Job saved') : 'Draft saved. Send it to AutoTalent Grid when ready.');
        navigate(`/employer/jobs/${res.id}`);
      },
    );

  return (
    <>
      <Link to={id ? `/employer/jobs/${id}` : '/employer/jobs'} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {id ? 'Back to the job' : 'Jobs'}
      </Link>
      <h1 className="mb-5 mt-3 text-[26px] font-bold tracking-tight">{id ? 'Edit job' : 'Post a job'}</h1>
      {(status === 'published' || status === 'paused') && <p className="mb-4 rounded-lg bg-info-tint px-3 py-2 text-sm text-info">Saving changes sends this job back to AutoTalent Grid for review. It is hidden from learners until approved again.</p>}
      <form
        noValidate
        className="card max-w-3xl space-y-4 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {draft.restored && <p className="rounded-lg bg-info-tint px-3 py-2 text-sm text-info">Your unsaved changes from last time were kept on this device.</p>}
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Job title" htmlFor="j-title" error={f.errors.title}>
          <input id="j-title" className="field-input" value={v.title} onChange={set('title')} placeholder="For example, Two-wheeler service technician" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skill area" htmlFor="j-skill" error={f.errors.skillArea}>
            <select id="j-skill" className="field-input" value={v.skillArea} onChange={set('skillArea')}>
              {SKILL_AREAS.map((s) => (
                <option key={s} value={s}>
                  {skillLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Experience needed (months)" htmlFor="j-exp" error={f.errors.minExperienceMonths}>
            <input id="j-exp" type="number" min={0} inputMode="numeric" className="field-input" value={v.minExperienceMonths} onChange={set('minExperienceMonths')} />
          </Field>
        </div>
        <Field label="Required skills" htmlFor="j-skills" error={f.errors.skills} hint="Separate with commas.">
          <input id="j-skills" className="field-input" value={v.skills} onChange={set('skills')} placeholder="Engine servicing, Brakes, Electrical basics" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="j-city" error={f.errors.city}>
            <input id="j-city" className="field-input" value={v.city} onChange={set('city')} />
          </Field>
          <Field label="Area or address (optional)" htmlFor="j-loc" error={f.errors.location}>
            <input id="j-loc" className="field-input" value={v.location} onChange={set('location')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Salary from (₹ a month, optional)" htmlFor="j-smin" error={f.errors.salaryMin}>
            <input id="j-smin" type="number" min={0} inputMode="numeric" className="field-input" value={v.salaryMin} onChange={set('salaryMin')} />
          </Field>
          <Field label="Salary to (₹ a month, optional)" htmlFor="j-smax" error={f.errors.salaryMax}>
            <input id="j-smax" type="number" min={0} inputMode="numeric" className="field-input" value={v.salaryMax} onChange={set('salaryMax')} />
          </Field>
          <Field label="Openings" htmlFor="j-open" error={f.errors.openings}>
            <input id="j-open" type="number" min={1} inputMode="numeric" className="field-input" value={v.openings} onChange={set('openings')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shift and conditions (optional)" htmlFor="j-shift" error={f.errors.shift}>
            <input id="j-shift" className="field-input" value={v.shift} onChange={set('shift')} placeholder="Day shift, 6 days a week" />
          </Field>
          <Field label="Closing date" htmlFor="j-close" error={f.errors.closingDate}>
            <input id="j-close" type="date" className="field-input" value={v.closingDate} onChange={set('closingDate')} />
          </Field>
        </div>
        <Field label="Job description" htmlFor="j-desc" error={f.errors.description}>
          <textarea id="j-desc" rows={6} className="field-input h-auto py-2" value={v.description} onChange={set('description')} />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.vtaCertificatePreferred} onChange={set('vtaCertificatePreferred')} />
          AutoTalent Grid certificate preferred
        </label>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={f.submitting}>
            {f.submitting ? 'Saving…' : id ? 'Save changes' : 'Save draft'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              draft.clear();
              navigate(id ? `/employer/jobs/${id}` : '/employer/jobs');
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

interface ApplicantRow {
  id: string;
  status: ApplicationStatus;
  appliedAt: string;
  name: string;
  city: string;
  skillAreas: string[];
  experienceMonths: number;
  verificationStatus: string;
  vtaCertificates: number;
  /** Phase 12: beyond the plan's applicant limit. */
  locked: boolean;
}

export function EmployerJobDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<'' | ApplicationStatus>('');
  const [error, setError] = useState('');
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const job = useQuery({ queryKey: ['employer', 'job', id], queryFn: () => api.get<JobView>(`/employer/jobs/${id}`) });
  const apps = useQuery({ queryKey: ['employer', 'job', id, 'applications', filter], queryFn: () => api.get<{ items: ApplicantRow[]; lockedCount: number }>(`/employer/jobs/${id}/applications${qs({ status: filter })}`) });
  if (job.isLoading) return <Spinner />;
  if (job.isError) return <ErrorNote message={(job.error as Error).message} />;
  const j = job.data!;

  const act = async (action: 'submit' | 'pause' | 'resume' | 'close', msg: string) => {
    setError('');
    try {
      await api.post(`/employer/jobs/${id}/${action}`);
      await qc.invalidateQueries({ queryKey: ['employer'] });
      toast('success', msg);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the job');
      setNeedsUpgrade(e instanceof ApiError && e.fields.plan === 'upgrade');
    }
  };

  return (
    <>
      <Link to="/employer/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Jobs
      </Link>
      <header className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{j.title}</h1>
          <p className="mt-1 text-muted">
            {skillLabel(j.skillArea)}, {j.city}
            {j.location ? ` (${j.location})` : ''}. Closes {shortDate(j.closingDate)}.
          </p>
          <div className="mt-2">
            <StatusBadge status={j.status!} label={JOB_STATUS_LABEL[j.status as JobStatus]} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {j.status !== 'closed' && (
            <Link to={`/employer/jobs/${id}/edit`} className="btn-secondary">
              Edit
            </Link>
          )}
          {(j.status === 'draft' || j.status === 'rejected') && (
            <button className="btn-primary" onClick={() => void act('submit', 'Sent to AutoTalent Grid for review')}>
              Send for review
            </button>
          )}
          {j.status === 'published' && (
            <button className="btn-secondary" onClick={() => void act('pause', 'Job paused')}>
              Pause
            </button>
          )}
          {j.status === 'paused' && (
            <button className="btn-primary" onClick={() => void act('resume', 'Job published again')}>
              Resume
            </button>
          )}
          {j.status !== 'closed' && (
            <button className="btn-quiet" onClick={() => void act('close', 'Job closed')}>
              Close job
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
          {needsUpgrade && (
            <Link to="/employer/subscription/plans" className="btn-primary mt-2">
              See plans
            </Link>
          )}
        </div>
      )}
      {j.moderationReason && (j.status === 'rejected' || j.status === 'paused' || j.status === 'closed') && (
        <p className="mb-4 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
          <span className="font-semibold">AutoTalent Grid&apos;s note:</span> {j.moderationReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Applicants</h2>
            <div role="tablist" aria-label="Application status" className="mt-3 flex flex-wrap gap-1">
              {(['', ...APPLICATION_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={filter === s}
                  onClick={() => setFilter(s)}
                  className={`h-8 rounded-full border px-3 text-[13px] font-medium ${filter === s ? 'border-brand bg-brand-tint text-brand' : 'border-line text-ink hover:bg-surface'}`}
                >
                  {s ? APPLICATION_STATUS_LABEL[s] : 'All'}
                  {s && j.pipeline?.[s] ? ` (${j.pipeline[s]})` : ''}
                </button>
              ))}
            </div>
          </div>
          {apps.isLoading ? (
            <Spinner />
          ) : !apps.data?.items.length ? (
            <EmptyState title="No applicants here" body={j.status === 'published' ? 'Applications appear here as learners apply.' : 'Applications open once AutoTalent Grid publishes the job.'} />
          ) : (
            <ul className="divide-y divide-line">
              {apps.data.lockedCount > 0 && (
                <li className="flex flex-wrap items-center gap-3 bg-warning-tint px-5 py-3 text-sm text-warning">
                  <Lock className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">
                    {apps.data.lockedCount} {apps.data.lockedCount === 1 ? 'applicant is' : 'applicants are'} hidden: your plan&apos;s applicant limit is reached.
                  </span>
                  <Link to="/employer/subscription/plans" className="font-semibold underline">
                    Upgrade plan
                  </Link>
                </li>
              )}
              {apps.data.items.map((a) =>
                a.locked ? (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-muted">
                    <Lock className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Hidden applicant</span>
                      <span className="block text-sm">Applied {shortDate(a.appliedAt)}. Upgrade your plan to see who it is.</span>
                    </span>
                  </li>
                ) : (
                <li key={a.id}>
                  <Link to={`/employer/applications/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface/60">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{a.name}</span>
                      <span className="block text-sm text-muted">
                        {a.city}, {a.skillAreas.map(skillLabel).join(', ') || 'skills not added'}, {experienceHave(a.experienceMonths)}. Applied {shortDate(a.appliedAt)}
                      </span>
                      {a.vtaCertificates > 0 && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                          <Award className="size-3.5" aria-hidden />
                          {a.vtaCertificates} AutoTalent Grid {a.vtaCertificates === 1 ? 'certificate' : 'certificates'}
                        </span>
                      )}
                    </span>
                    <StatusBadge status={a.status} label={APPLICATION_STATUS_LABEL[a.status]} />
                  </Link>
                </li>
                ),
              )}
            </ul>
          )}
        </section>
        <aside className="card h-fit space-y-3 px-5 py-4 text-sm">
          <p className="font-semibold">{salaryText(j.salaryMin, j.salaryMax)}</p>
          <p>{j.openings} openings</p>
          <p>{experienceText(j.minExperienceMonths)}</p>
          {j.shift && <p>{j.shift}</p>}
          {j.skills.length > 0 && <p className="text-muted">Skills: {j.skills.join(', ')}</p>}
          {j.vtaCertificatePreferred && <p className="font-medium text-brand">AutoTalent Grid certificate preferred</p>}
          <p className="whitespace-pre-line border-t border-line pt-3 text-muted">{j.description}</p>
        </aside>
      </div>
    </>
  );
}
