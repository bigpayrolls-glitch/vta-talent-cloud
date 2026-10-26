import { useQuery } from '@tanstack/react-query';
import { JOB_STATUS_LABEL, type JobStatus } from '@vta/shared';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorNote, formatDate, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { shortDate } from '../hiring/format';
import { CurrentPlanCard } from './Subscription';

interface Dash {
  asOf: string;
  verificationStatus: string;
  totals: { openJobs: number; applicants: number; shortlisted: number; interviews: number; offers: number; joined: number };
  jobs: { id: string; title: string; status: JobStatus; closingDate: string; openings: number; applicants: number; shortlisted: number; interviews: number; offers: number; joined: number }[];
}

/** EM-09: vacancies with applicants, shortlisted, interviews, offers and confirmed joinings. */
export function EmployerDashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['employer', 'dashboard'], queryFn: () => api.get<Dash>('/employer/dashboard') });
  return (
    <>
      <section className="rounded-[20px] bg-brand-tint px-6 py-7 sm:px-10">
        <h1 className="text-[28px] font-extrabold tracking-tight sm:text-[34px]">Hello, {firstName(me?.name ?? '')}!</h1>
        <p className="mt-1 text-lg text-ink/75">Post jobs and hire skilled technicians for your service network.</p>
        <Link to="/employer/jobs/new" className="btn-primary mt-5">
          <Plus className="size-4" aria-hidden />
          Post a job
        </Link>
      </section>
      <div className="mt-6">
        <CurrentPlanCard />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <div className="mt-6">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      ) : (
        (() => {
          const d = q.data!;
          const tiles = [
            ['Open jobs', d.totals.openJobs],
            ['Applicants', d.totals.applicants],
            ['Shortlisted now', d.totals.shortlisted],
            ['At interview now', d.totals.interviews],
            ['Offers now', d.totals.offers],
            ['Joined', d.totals.joined],
          ] as const;
          return (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {tiles.map(([label, n]) => (
                  <div key={label} className="card px-4 py-3">
                    <p className="text-[26px] font-bold leading-none">{n}</p>
                    <p className="mt-1.5 text-sm text-muted">{label}</p>
                  </div>
                ))}
              </div>
              <section className="mt-8">
                <h2 className="text-xl font-bold">Your jobs</h2>
                {!d.jobs.length ? (
                  <div className="card mt-3">
                    <EmptyState title="No jobs yet" body="Post a job. AutoTalent Grid checks each job before learners see it." />
                  </div>
                ) : (
                  <div className="card mt-3 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <caption className="sr-only">Jobs and their applicants</caption>
                      <thead className="border-b border-line text-left text-[13px] text-muted">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Job</th>
                          <th className="px-3 py-2.5 font-medium">Status</th>
                          <th className="px-3 py-2.5 text-right font-medium">Applicants</th>
                          <th className="px-3 py-2.5 text-right font-medium">Shortlisted</th>
                          <th className="px-3 py-2.5 text-right font-medium">Interviews</th>
                          <th className="px-3 py-2.5 text-right font-medium">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {d.jobs.map((j) => (
                          <tr key={j.id}>
                            <td className="px-4 py-3">
                              <Link to={`/employer/jobs/${j.id}`} className="font-semibold hover:text-brand">
                                {j.title}
                              </Link>
                              <p className="text-[13px] text-muted">Closes {shortDate(j.closingDate)}, {j.openings} openings</p>
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} />
                            </td>
                            <td className="px-3 py-3 text-right">{j.applicants}</td>
                            <td className="px-3 py-3 text-right">{j.shortlisted}</td>
                            <td className="px-3 py-3 text-right">{j.interviews}</td>
                            <td className="px-3 py-3 text-right font-semibold">{j.joined}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <p className="mt-6 text-sm text-muted">
                As of {formatDate(d.asOf, true)}. &ldquo;Joined&rdquo; counts joinings you recorded; AutoTalent Grid may follow up to confirm them.
              </p>
            </>
          );
        })()
      )}
    </>
  );
}
