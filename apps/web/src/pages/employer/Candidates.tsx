import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_INFO, SKILL_AREAS, type Page, type SearchUsageDto } from '@vta/shared';
import { ArrowLeft, Award, ExternalLink, FileText, Lock, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { experienceHave, shortDate, skillLabel, type JobView } from '../hiring/format';

interface CandidateRow {
  id: string;
  name: string;
  city: string | null;
  preferredWorkArea: string | null;
  skillAreas: string[];
  experienceMonths: number;
  languages: string[];
  availability: string | null;
  vtaCertificates: string[];
  /** False while AutoTalent Grid has not yet checked the profile. */
  verified: boolean;
}

export const useSearchUsage = () => useQuery({ queryKey: ['employer', 'search-usage'], queryFn: () => api.get<SearchUsageDto>('/employer/candidates/usage') });

const dayMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** What the employer's plan allows in candidate search, and what is used this month. */
function UsageBar({ u }: { u: SearchUsageDto }) {
  const item = (label: string, x: { used: number; limit: number | null }) =>
    x.limit === null ? (
      <span>{label}: no limit</span>
    ) : (
      <span className={x.used >= x.limit ? 'font-semibold text-brand' : ''}>
        {label}: {x.used} of {x.limit} used
      </span>
    );
  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <p className="flex flex-wrap gap-x-5 gap-y-1">
        <span className="font-semibold">{PLAN_INFO[u.plan].name} plan</span>
        {item('Profile views', u.profileViews)}
        {item('Invites', u.invites)}
        <span className="text-muted">Resets {dayMonth(u.resetsOn)}</span>
      </p>
      {u.plan !== 'enterprise' && (
        <Link to="/employer/subscription/plans" className="inline-flex items-center gap-1.5 font-semibold text-[#C8101A] hover:underline">
          <Sparkles className="size-4" aria-hidden /> Upgrade
        </Link>
      )}
    </div>
  );
}

/** Shown when a plan limit is reached. */
export function UpgradeNote({ message }: { message: string }) {
  return (
    <div className="card flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        {message}
      </p>
      <Link to="/employer/subscription/plans" className="btn-primary shrink-0 bg-[#C8101A]">
        See plans
      </Link>
    </div>
  );
}

const isPlanLimit = (e: unknown) => e instanceof ApiError && e.fields.plan === 'limit';

/** EM-04: search people who chose to be found by employers. Contact details open on the profile on paid plans. */
export function CandidateSearchPage() {
  const usage = useSearchUsage();
  const allFilters = usage.data?.allFilters ?? true;
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const [city, setCity] = useState(get('city'));
  const filters = { skillArea: get('skillArea'), city: get('city'), minExperienceMonths: get('minExperienceMonths'), hasCertificate: get('hasCertificate'), page: get('page') || '1' };
  const q = useQuery({
    queryKey: ['employer', 'candidates', filters],
    queryFn: () => api.get<Page<CandidateRow> & { matched: number | null; more?: boolean; limitedTo: number | null }>(`/employer/candidates${qs({ ...filters, ...(allFilters ? {} : { minExperienceMonths: '', hasCertificate: '' }), pageSize: 20 })}`),
    enabled: !usage.isLoading,
    placeholderData: (p) => p,
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };

  return (
    <>
      <PageHeader title="Find candidates" description="People who can be found by employers. Contact details are shown on paid plans." />
      {usage.data && <UsageBar u={usage.data} />}
      <form
        className="card mb-4 grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          set('city', city.trim());
        }}
      >
        <div>
          <label className="field-label" htmlFor="f-skill">
            Skill area
          </label>
          <select id="f-skill" className="field-input" value={filters.skillArea} onChange={(e) => set('skillArea', e.target.value)}>
            <option value="">Any</option>
            {SKILL_AREAS.map((s) => (
              <option key={s} value={s}>
                {skillLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="f-city">
            City or area
          </label>
          <input id="f-city" className="field-input" value={city} onChange={(e) => setCity(e.target.value)} onBlur={() => set('city', city.trim())} />
        </div>
        <div>
          <label className="field-label" htmlFor="f-exp">
            Experience {!allFilters && <Lock className="inline size-3.5 text-muted" aria-label="Starter plan and above" />}
          </label>
          <select id="f-exp" className="field-input" value={allFilters ? filters.minExperienceMonths : ''} disabled={!allFilters} title={allFilters ? undefined : 'Starter plan and above'} onChange={(e) => set('minExperienceMonths', e.target.value)}>
            <option value="">Any</option>
            <option value="6">6 months or more</option>
            <option value="12">1 year or more</option>
            <option value="24">2 years or more</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="f-cert">
            AutoTalent Grid certificate {!allFilters && <Lock className="inline size-3.5 text-muted" aria-label="Starter plan and above" />}
          </label>
          <select id="f-cert" className="field-input" value={allFilters ? filters.hasCertificate : ''} disabled={!allFilters} title={allFilters ? undefined : 'Starter plan and above'} onChange={(e) => set('hasCertificate', e.target.value)}>
            <option value="">Any</option>
            <option value="yes">Has an AutoTalent Grid certificate</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full">
            Search
          </button>
        </div>
      </form>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <div className="card">
          <EmptyState title="No candidates match" body="Try fewer filters. People who turned off “Employers can find my profile” do not appear." />
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">{q.data!.matched !== null ? `${q.data!.matched.toLocaleString('en-IN')} found` : `${q.data!.total} candidates shown${q.data!.more ? ` (your plan shows the first ${q.data!.limitedTo})` : ''}`}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data!.items.map((c) => (
              <li key={c.id}>
                <Link to={`/employer/candidates/${c.id}`} className="card block h-full px-5 py-4 hover:border-brand">
                  <p className="font-semibold">
                    {c.name}
                    {!c.verified && <span className="ml-2 rounded-full bg-surface px-2 py-0.5 align-middle text-xs font-medium text-muted">Not verified yet</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {c.city ?? 'City not given'}
                    {c.preferredWorkArea ? `, prefers ${c.preferredWorkArea}` : ''}
                  </p>
                  <p className="mt-2 text-sm">
                    {c.skillAreas.map(skillLabel).join(', ') || 'Skills not added'}, {experienceHave(c.experienceMonths)}
                  </p>
                  {c.availability && <p className="text-sm text-muted">Available: {c.availability}</p>}
                  {c.vtaCertificates.length > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                      <Award className="size-3.5" aria-hidden />
                      {c.vtaCertificates.join(', ')}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <div className="card mt-3">
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => setParams(new URLSearchParams({ ...Object.fromEntries(params), page: String(p) }))} />
          </div>
          {q.data!.more && (
            <div className="mt-3">
              <UpgradeNote message="More candidates match this search. Upgrade to Starter to see them all, use every filter and view contact details." />
            </div>
          )}
        </>
      )}
    </>
  );
}

interface CandidateProfile {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  preferredWorkArea: string | null;
  skillAreas: string[];
  experienceMonths: number;
  education: string | null;
  languages: string[];
  availability: string | null;
  verified: boolean;
  certificates: { id: string; course: string; issueDate: string; verifyPath: string }[];
  documents: { id: string; title: string; verificationStatus: string }[];
  contact: string;
  phone: string | null;
  email: string | null;
  contactNeedsUpgrade: boolean;
  invitations: { jobId: string; title: string; at: string }[];
}

/** EM-05: permitted fields only. Opening this page is logged (EM-10). */
export function CandidateProfilePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['employer', 'candidate', id],
    queryFn: async () => {
      const r = await api.get<CandidateProfile>(`/employer/candidates/${id}`);
      void qc.invalidateQueries({ queryKey: ['employer', 'search-usage'] }); // this view may have used one of the month's views
      return r;
    },
    retry: (n, e) => !isPlanLimit(e) && n < 2,
  });
  const [inviting, setInviting] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.isError && isPlanLimit(q.error)) return <UpgradeNote message={(q.error as Error).message} />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  return (
    <>
      <Link to="/employer/candidates" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Find candidates
      </Link>
      <header className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{c.name}</h1>
          {!c.verified && <p className="mt-1 text-sm text-muted">Not verified yet: AutoTalent Grid has not checked this profile.</p>}
          <p className="mt-1 text-muted">
            {[c.city, c.state].filter(Boolean).join(', ') || 'City not given'}.{c.verified ? ' Verified by AutoTalent Grid.' : ''}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setInviting(true)}>
          <Send className="size-4" aria-hidden />
          Invite to apply
        </button>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="card divide-y divide-line">
          {(
            [
              ['Preferred work area', c.preferredWorkArea],
              ['Skills', c.skillAreas.map(skillLabel).join(', ')],
              ['Experience', experienceHave(c.experienceMonths)],
              ['Education', c.education],
              ['Languages', c.languages.join(', ')],
              ['Availability', c.availability],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="grid gap-0.5 px-5 py-2.5 text-sm sm:grid-cols-[180px_1fr]">
              <span className="text-muted">{k}</span>
              <span>{v || '—'}</span>
            </div>
          ))}
          {c.phone || c.email ? (
            <div className="grid gap-0.5 px-5 py-2.5 text-sm sm:grid-cols-[180px_1fr]">
              <span className="text-muted">Contact</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="font-semibold text-brand underline">
                    {c.phone.replace('+91', '+91 ')}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="font-semibold text-brand underline">
                    {c.email}
                  </a>
                )}
              </span>
            </div>
          ) : c.contactNeedsUpgrade ? (
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm text-muted">
              <Lock className="size-4" aria-hidden />
              Contact details are in the Starter plan and above.
              <Link to="/employer/subscription/plans" className="font-semibold text-brand underline">
                Upgrade
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-5 py-3 text-sm text-muted">
              <Lock className="size-4" aria-hidden />
              Contact: not given.
            </div>
          )}
        </section>
        <aside className="space-y-6">
          <section className="card px-5 py-4 text-sm">
            <h2 className="font-semibold">AutoTalent Grid certificates</h2>
            {!c.certificates.length ? (
              <p className="mt-1 text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {c.certificates.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <span>
                      {x.course}, {shortDate(x.issueDate)}
                    </span>
                    <a href={x.verifyPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand">
                      Check <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {c.documents.length > 0 && (
            <section className="card px-5 py-4 text-sm">
              <h2 className="font-semibold">Documents</h2>
              <ul className="mt-2 space-y-1.5">
                {c.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <FileText className="size-4 text-muted" aria-hidden />
                    {d.title} <StatusBadge status={d.verificationStatus} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-muted">Files open once they apply to one of your jobs.</p>
            </section>
          )}
          {c.invitations.length > 0 && (
            <p className="text-sm text-muted">
              Invited to: {c.invitations.map((i) => i.title).join(', ')}
            </p>
          )}
        </aside>
      </div>
      {inviting && <InviteModal candidateId={c.id} name={c.name} onClose={() => setInviting(false)} onDone={() => void q.refetch()} />}
    </>
  );
}

function InviteModal({ candidateId, name, onClose, onDone }: { candidateId: string; name: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const jobs = useQuery({ queryKey: ['employer', 'jobs', 'published'], queryFn: () => api.get<{ items: JobView[] }>('/employer/jobs?status=published') });
  const [jobId, setJobId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState('');
  const qc = useQueryClient();
  const send = async () => {
    setError('');
    try {
      await api.post(`/employer/candidates/${candidateId}/invite`, { jobId, message });
      toast('success', `${name} was invited. They decide whether to apply.`);
      await qc.invalidateQueries({ queryKey: ['employer', 'search-usage'] });
      onDone();
      onClose();
    } catch (e) {
      if (isPlanLimit(e)) setLimit((e as Error).message);
      else setError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Could not send');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite to apply"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!jobId} onClick={() => void send()}>
            Send invitation
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {limit && <UpgradeNote message={limit} />}
        {error && <ErrorNote message={error} />}
        <Field label="Job" htmlFor="inv-job">
          <select id="inv-job" className="field-input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose one of your published jobs</option>
            {jobs.data?.items.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message (optional)" htmlFor="inv-msg">
          <textarea id="inv-msg" rows={3} maxLength={300} className="field-input h-auto py-2" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <p className="text-[13px] text-muted">The candidate sees the invitation in their Jobs page. Their contact details are shared only if they apply.</p>
      </div>
    </Modal>
  );
}
