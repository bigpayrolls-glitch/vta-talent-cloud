import { useQuery } from '@tanstack/react-query';
import { JOB_STATUS_LABEL, type JobStatus } from '@vta/shared';
import { Plus, Search } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorNote, formatDate, Spinner, StatusBadge } from '../../components/ui';
import { HeroBanner, heroPrimary, heroSecondary, MiniStat, NextSteps, Panel, StatCard, StatRow } from '../../components/Showroom';
import { api } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { shortDate } from '../hiring/format';
import { CurrentPlanCard } from './Subscription';

interface Dash {
  asOf: string;
  verificationStatus: string;
  totals: { openJobs: number; applicants: number; shortlisted: number; interviews: number; offers: number; joined: number };
  jobs: { id: string; title: string; status: JobStatus; closingDate: string; openings: number; createdAt: string; applicants: number; shortlisted: number; interviews: number; offers: number; joined: number }[];
}

/** EM-09: vacancies with applicants, shortlisted, interviews, offers and confirmed joinings. */
export function EmployerDashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['employer', 'dashboard'], queryFn: () => api.get<Dash>('/employer/dashboard') });
  const org = me?.roles.find((r) => r.role.startsWith('employer') && r.organisationName)?.organisationName;
  const d = q.data;
  return (
    <>
      <HeroBanner
        eyebrow={org ? `Employer portal · ${org}` : 'Employer portal'}
        title={`Hello, ${firstName(me?.name ?? '')}!`}
        subtitle="Post jobs and hire skilled technicians for your service network."
        floating={!!d}
        actions={
          <>
            <Link to="/employer/jobs/new" className={heroPrimary}>
              <Plus className="size-4" aria-hidden />
              Post a job
            </Link>
            <Link to="/employer/candidates" className={heroSecondary}>
              <Search className="size-4" aria-hidden />
              Search candidates
            </Link>
          </>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <div className="mt-6">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      ) : (
        d && <Body d={d} />
      )}
      <div className="mt-6">
        <CurrentPlanCard className="rounded-[22px] bg-white p-5 sm:p-6" />
      </div>
      {d && (
        <p className="mt-6 text-sm text-[#5B616E]">
          As of {formatDate(d.asOf, true)}. &ldquo;Joined&rdquo; counts joinings you recorded; AutoTalent Grid may follow up to confirm them.
        </p>
      )}
    </>
  );
}

function Body({ d }: { d: Dash }) {
  const drafts = d.jobs.filter((j) => j.status === 'draft');
  const steps: { label: string; to: string }[] = [];
  if (d.totals.shortlisted > 0) steps.push({ label: `Arrange interviews for ${d.totals.shortlisted} shortlisted ${d.totals.shortlisted === 1 ? 'candidate' : 'candidates'}`, to: '/employer/jobs' });
  if (d.totals.offers > 0) steps.push({ label: `${d.totals.offers} ${d.totals.offers === 1 ? 'offer' : 'offers'} made: record the joining once they start`, to: '/employer/jobs' });
  if (drafts.length > 0) steps.push({ label: drafts.length === 1 ? 'Finish and submit your draft job' : `Finish and submit your ${drafts.length} draft jobs`, to: `/employer/jobs/${drafts[0]!.id}` });
  if (d.totals.openJobs === 0) steps.push({ label: 'Post your first job', to: '/employer/jobs/new' });
  steps.push({ label: 'Search certified candidates near you', to: '/employer/candidates' });

  return (
    <>
      <StatRow cols={6}>
        <StatCard label="Open jobs" value={d.totals.openJobs} to="/employer/jobs" />
        <StatCard label="Applicants" value={d.totals.applicants} />
        <StatCard label="Shortlisted now" value={d.totals.shortlisted} />
        <StatCard label="At interview now" value={d.totals.interviews} />
        <StatCard label="Offers now" value={d.totals.offers} />
        <StatCard label="Joined" value={d.totals.joined} note="Confirmed hires" highlight />
      </StatRow>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Recent jobs" id="emp-jobs" link={{ to: '/employer/jobs', label: 'View all jobs' }}>
          {!d.jobs.length ? (
            <EmptyState title="No jobs yet" body="Post a job. AutoTalent Grid checks each job before learners see it." />
          ) : (
            <ul className="grid gap-3.5 md:grid-cols-2">
              {d.jobs.map((j) => (
                <li key={j.id} className="flex min-w-0 flex-col gap-2.5 rounded-[18px] border border-[#E3E6EA] p-4 sm:p-[18px]">
                  <span className="self-start">
                    <StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} />
                  </span>
                  <Link to={`/employer/jobs/${j.id}`} className="font-display text-[16px] font-bold leading-snug hover:text-[#C8101A]">
                    {j.title}
                  </Link>
                  <span className="text-[13px] text-[#5B616E]">
                    Closes {shortDate(j.closingDate)}, {j.openings} openings · Created {shortDate(j.createdAt.slice(0, 10))}
                  </span>
                  <div className="mt-auto flex gap-1.5 pt-1">
                    <MiniStat n={j.applicants} label="Applicants" />
                    <MiniStat n={j.shortlisted} label="Shortlisted" />
                    <MiniStat n={j.interviews} label="Interviews" />
                    <MiniStat n={j.joined} label="Joined" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <NextSteps title="Next steps" id="emp-next" items={steps} />
      </div>
    </>
  );
}
