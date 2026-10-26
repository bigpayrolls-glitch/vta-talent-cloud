import { useQuery, useQueryClient } from '@tanstack/react-query';
import { JOB_STATUS_LABEL, moderationSchema, type JobStatus, type Page } from '@vta/shared';
import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useForm } from '../../lib/useForm';
import { experienceText, salaryText, shortDate, skillLabel, type JobView } from '../hiring/format';

type AdminJob = JobView & { employer: string; employerId?: string; employerVerification: string; submittedAt: string | null; moderatedAt?: string | null };

const TABS = [
  { key: 'pending_review', label: 'To review' },
  { key: 'published', label: 'Published' },
  { key: 'paused', label: 'Paused' },
  { key: 'rejected', label: 'Not approved' },
  { key: 'closed', label: 'Closed' },
  { key: '', label: 'All' },
];

/** AD-09: review, publish, pause or close job posts, with a reason. */
export function JobModerationPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending_review';
  const page = Number(params.get('page') ?? 1);
  const q = useQuery({ queryKey: ['admin', 'jobs', status, page], queryFn: () => api.get<Page<AdminJob>>(`/admin/jobs${qs({ status, page })}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Jobs" description="Learners see a job only after VTA publishes it." />
      <div role="tablist" aria-label="Job status" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-surface p-1">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setParams({ status: t.key })} className={`h-9 rounded-lg px-3 text-sm font-semibold ${status === t.key ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}>
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
          <EmptyState title={status === 'pending_review' ? 'Nothing to review' : 'No jobs here'} />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {q.data!.items.map((j) => (
              <li key={j.id}>
                <Link to={`/admin/jobs/${j.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface/60">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{j.title}</span>
                    <span className="block text-sm text-muted">
                      {j.employer}, {j.city}. {j.submittedAt ? `Sent ${shortDate(j.submittedAt)}` : ''}
                    </span>
                  </span>
                  <StatusBadge status={j.status!} label={JOB_STATUS_LABEL[j.status as JobStatus]} />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => setParams({ status, page: String(p) })} />
        </div>
      )}
    </>
  );
}

type Action = 'publish' | 'reject' | 'pause' | 'close';
const ACTION_LABEL: Record<Action, string> = { publish: 'Publish', reject: 'Do not approve', pause: 'Pause', close: 'Close' };
const ALLOWED: Record<string, Action[]> = { pending_review: ['publish', 'reject', 'close'], published: ['pause', 'close'], paused: ['publish', 'close'] };

export function JobModerationDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'job', id], queryFn: () => api.get<AdminJob>(`/admin/jobs/${id}`) });
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const j = q.data!;
  const publish = async () => {
    setError('');
    try {
      await api.post(`/admin/jobs/${id}/moderate`, { action: 'publish' });
      await qc.invalidateQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('success', 'Job published');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not publish');
    }
  };
  return (
    <>
      <Link to="/admin/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Jobs
      </Link>
      <header className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{j.title}</h1>
          <p className="mt-1 text-muted">
            {j.employer} <StatusBadge status={j.employerVerification} />
          </p>
          <div className="mt-2">
            <StatusBadge status={j.status!} label={JOB_STATUS_LABEL[j.status as JobStatus]} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(ALLOWED[j.status!] ?? []).map((a) => (
            <button key={a} className={a === 'publish' ? 'btn-primary' : 'btn-secondary'} onClick={() => (a === 'publish' ? void publish() : setAction(a))}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {j.moderationReason && <p className="mb-4 rounded-lg bg-surface px-4 py-3 text-sm">Last note: {j.moderationReason}</p>}
      <section className="card max-w-3xl px-5 py-5 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted">Skill area</dt>
            <dd>{skillLabel(j.skillArea)}</dd>
          </div>
          <div>
            <dt className="text-muted">Where</dt>
            <dd>
              {j.city}
              {j.location ? `, ${j.location}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Salary</dt>
            <dd>{salaryText(j.salaryMin, j.salaryMax)}</dd>
          </div>
          <div>
            <dt className="text-muted">Experience</dt>
            <dd>{experienceText(j.minExperienceMonths)}</dd>
          </div>
          <div>
            <dt className="text-muted">Openings</dt>
            <dd>{j.openings}</dd>
          </div>
          <div>
            <dt className="text-muted">Closing date</dt>
            <dd>{shortDate(j.closingDate)}</dd>
          </div>
          {j.shift && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Shift and conditions</dt>
              <dd>{j.shift}</dd>
            </div>
          )}
          {j.skills.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Skills</dt>
              <dd>{j.skills.join(', ')}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 whitespace-pre-line border-t border-line pt-4">{j.description}</p>
        <p className="mt-4 text-[13px] text-muted">Check for: a real role with clear duties, lawful pay and conditions, no fees asked from candidates, and no promise VTA cannot keep.</p>
      </section>
      {action && <ModerationModal id={id} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

function ModerationModal({ id, action, onClose }: { id: string; action: Action; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(moderationSchema);
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={ACTION_LABEL[action]}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={f.submitting}
            onClick={() =>
              void f.submit({ action, reason }, async (data) => {
                await api.post(`/admin/jobs/${id}/moderate`, data);
                await qc.invalidateQueries({ queryKey: ['admin'] });
                await qc.invalidateQueries({ queryKey: ['dashboard'] });
                toast('success', 'Saved');
                onClose();
              })
            }
          >
            {ACTION_LABEL[action]}
          </button>
        </>
      }
    >
      {f.formError && <ErrorNote message={f.formError} />}
      <Field label="Reason (the employer sees it)" htmlFor="mod-reason" error={f.errors.reason}>
        <textarea id="mod-reason" rows={3} className="field-input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

interface Outcome {
  id: string;
  status: 'joined' | 'not_joined';
  joiningDate: string | null;
  verification: 'unverified' | 'verified' | 'flagged';
  note: string | null;
  recordedAt: string;
  job: string;
  employer: string;
  candidate: { id: string; name: string; code: string };
}

/** EM-08: VTA confirms recorded joinings (an offer alone is never a joining) or flags them for follow-up. */
export function HiringOutcomesPage() {
  const [params, setParams] = useSearchParams();
  const verification = params.get('verification') ?? 'unverified';
  const q = useQuery({ queryKey: ['admin', 'outcomes', verification], queryFn: () => api.get<Page<Outcome>>(`/admin/hiring-outcomes${qs({ verification })}`) });
  const [reviewing, setReviewing] = useState<Outcome | null>(null);
  return (
    <>
      <PageHeader title="Hiring outcomes" description="Joinings recorded by employers. Confirm them, for example by phoning the employer and the candidate, or flag them for follow-up." />
      <div role="tablist" aria-label="Verification" className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-surface p-1">
        {(
          [
            ['unverified', 'To confirm'],
            ['flagged', 'Flagged'],
            ['verified', 'Confirmed'],
            ['', 'All'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={verification === k} onClick={() => setParams({ verification: k })} className={`h-9 rounded-lg px-3 text-sm font-semibold ${verification === k ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <div className="card">
          <EmptyState title="Nothing here" body="Joinings that employers record appear here." />
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {q.data.items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  <Link to={`/admin/candidates/${o.candidate.id}`} className="hover:text-brand">
                    {o.candidate.name}
                  </Link>{' '}
                  <span className="font-normal text-muted">({o.candidate.code})</span>
                </span>
                <span className="block text-sm text-muted">
                  {o.status === 'joined' ? `Joined ${o.employer} on ${shortDate(o.joiningDate!)}` : `Did not join ${o.employer}`}, {o.job}
                </span>
                {o.note && (
                  <span className="mt-1 flex items-center gap-1 text-[13px]">
                    {o.verification === 'flagged' && <AlertTriangle className="size-3.5 text-brand" aria-hidden />}
                    {o.note}
                  </span>
                )}
              </span>
              <StatusBadge status={o.verification} label={o.verification === 'unverified' ? 'To confirm' : o.verification === 'verified' ? 'Confirmed' : 'Flagged'} />
              {o.verification !== 'verified' && (
                <button className="btn-secondary btn-sm" onClick={() => setReviewing(o)}>
                  Review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {reviewing && <OutcomeModal o={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function OutcomeModal({ o, onClose }: { o: Outcome; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const decide = async (decision: 'verified' | 'flagged') => {
    setError('');
    try {
      await api.post(`/admin/applications/${o.id}/outcome-review`, { decision, note });
      await qc.invalidateQueries({ queryKey: ['admin', 'outcomes'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('success', decision === 'verified' ? 'Outcome confirmed' : 'Flagged for follow-up');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Could not save');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${o.candidate.name}: ${o.status === 'joined' ? 'joining' : 'did not join'}`}
      footer={
        <>
          <button className="btn-secondary" onClick={() => void decide('flagged')}>
            Flag for follow-up
          </button>
          <button className="btn-primary" onClick={() => void decide('verified')}>
            Confirm
          </button>
        </>
      }
    >
      {error && <ErrorNote message={error} />}
      <p className="text-sm">
        {o.employer}, {o.job}
        {o.joiningDate ? `. Joining date ${shortDate(o.joiningDate)}` : ''}.
      </p>
      <div className="mt-4">
        <Field label="How was it checked, or what needs following up?" htmlFor="oc-note" hint="Needed when flagging.">
          <textarea id="oc-note" rows={3} className="field-input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

interface CompanyAdminView {
  legalName: string;
  sector: string | null;
  city: string | null;
  gstin: string | null;
  website: string | null;
  submittedAt: string | null;
  possibleDuplicate: { id: string; legalName: string; verificationStatus: string } | null;
  documents: { id: string; title: string; createdAt: string }[];
}

/** AD-08: what an employer sent for verification, shown inside the organisation dialog. */
export function CompanyVerificationDetails({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ['admin', 'company', orgId], queryFn: () => api.get<CompanyAdminView>(`/admin/organisations/${orgId}/company`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return null;
  const c = q.data;
  const open = async (docId: string) => {
    const { url } = await api.get<{ url: string }>(`/admin/organisations/${orgId}/documents/${docId}/link`);
    window.open(url, '_blank', 'noopener');
  };
  return (
    <div className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
      {c.possibleDuplicate && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Possible duplicate of {c.possibleDuplicate.legalName} ({c.possibleDuplicate.verificationStatus}). Check before verifying.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Sector</dt>
        <dd>{c.sector?.replace('_', ' ') ?? '—'}</dd>
        <dt className="text-muted">City</dt>
        <dd>{c.city ?? '—'}</dd>
        <dt className="text-muted">GSTIN</dt>
        <dd>{c.gstin ?? '—'}</dd>
        <dt className="text-muted">Sent to VTA</dt>
        <dd>{c.submittedAt ? shortDate(c.submittedAt) : 'Not yet'}</dd>
      </dl>
      <div>
        <p className="font-semibold">Documents</p>
        {!c.documents.length ? (
          <p className="text-muted">None uploaded.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {c.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <FileText className="size-4 text-muted" aria-hidden />
                <span className="flex-1">{d.title}</span>
                <button className="font-medium text-brand" onClick={() => void open(d.id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
