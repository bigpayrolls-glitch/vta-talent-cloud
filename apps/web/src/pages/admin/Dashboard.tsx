import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Briefcase, Building2, ClipboardList, GraduationCap, Handshake, MapPin, UserCog, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorNote, formatDate, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';

interface PlatformDashboard {
  asOf: string;
  scope: 'platform';
  learners: { active: number };
  trainers: { active: number };
  employers: { total: number; verified: number };
  partners: { total: number; verified: number };
  centres: { active: number };
  training: {
    activeCourses: number;
    batchesPlanned: number;
    batchesActive: number;
    batchesCompleted: number;
    enrolledInOpenBatches: number;
    candidatesVerified: number;
    candidatesTotal: number;
  };
  hiring: { openJobs: number; applications: number; joinedRecorded: number; joinedVerified: number };
  awaitingAction: {
    jobsPendingReview: number;
    outcomesToVerify: number;
    usersPendingApproval: number;
    organisationsPendingVerification: number;
    candidatesPendingVerification: number;
    possibleDuplicates: number;
    trainersPendingVerification: number;
  };
}
interface CentreDashboard {
  asOf: string;
  scope: 'centre';
  centres: { active: number };
  batches: { planned: number; active: number; completed: number };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function AdminDashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<PlatformDashboard | CentreDashboard>('/admin/dashboard') });

  return (
    <div>
      <section className="rounded-[20px] bg-brand-tint px-6 py-8 sm:px-10">
        <h1 className="text-[30px] font-extrabold tracking-tight sm:text-[34px]">Welcome, {firstName(me?.name ?? '')}!</h1>
        <p className="mt-1 text-lg text-ink/75">Manage the platform.</p>
      </section>

      {q.isLoading && <Spinner />}
      {q.isError && <div className="mt-6"><ErrorNote message={(q.error as Error).message} /></div>}

      {q.data?.scope === 'platform' && <PlatformView d={q.data} />}
      {q.data?.scope === 'centre' && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={MapPin} label="Your centres" value={q.data.centres.active} />
          <Tile icon={UsersRound} label="Planned batches" value={q.data.batches.planned} to="/admin/batches?status=planned" />
          <Tile icon={UsersRound} label="Active batches" value={q.data.batches.active} to="/admin/batches?status=active" />
          <Tile icon={UsersRound} label="Completed batches" value={q.data.batches.completed} to="/admin/batches?status=completed" />
        </div>
      )}
      {q.data && <p className="mt-8 text-sm text-muted">Counts as of {formatDate(q.data.asOf, true)}. Active accounts and organisations only.</p>}
    </div>
  );
}

function PlatformView({ d }: { d: PlatformDashboard }) {
  const a = d.awaitingAction;
  const tasks = [
    { n: a.candidatesPendingVerification, label: plural(a.candidatesPendingVerification, 'candidate to verify', 'candidates to verify'), to: '/admin/candidates?verificationStatus=pending' },
    { n: a.possibleDuplicates, label: plural(a.possibleDuplicates, 'possible duplicate profile to review', 'possible duplicate profiles to review'), to: '/admin/candidates?duplicates=true' },
    { n: a.trainersPendingVerification, label: plural(a.trainersPendingVerification, 'trainer to verify', 'trainers to verify'), to: '/admin/trainers?verificationStatus=pending' },
    { n: a.organisationsPendingVerification, label: plural(a.organisationsPendingVerification, 'organisation waiting for verification', 'organisations waiting for verification'), to: '/admin/organisations?verificationStatus=pending' },
    { n: a.jobsPendingReview, label: plural(a.jobsPendingReview, 'job to review', 'jobs to review'), to: '/admin/jobs?status=pending_review' },
    { n: a.outcomesToVerify, label: plural(a.outcomesToVerify, 'hiring outcome to confirm', 'hiring outcomes to confirm'), to: '/admin/outcomes' },
    { n: a.usersPendingApproval, label: plural(a.usersPendingApproval, 'user waiting for approval', 'users waiting for approval'), to: '/admin/users?status=pending' },
  ].filter((t) => t.n > 0);
  const t = d.training;

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={GraduationCap} label="Candidates" value={t.candidatesTotal} note={`${t.candidatesVerified} verified`} to="/admin/candidates" />
        <Tile icon={UsersRound} label="Active batches" value={t.batchesActive} note={`${t.batchesPlanned} planned, ${t.batchesCompleted} completed`} to="/admin/batches?status=active" />
        <Tile icon={ClipboardList} label="Enrolled now" value={t.enrolledInOpenBatches} note="In planned and active batches" />
        <Tile icon={BookOpen} label="Active courses" value={t.activeCourses} to="/admin/courses?status=active" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={UserCog} label="Trainers" value={d.trainers.active} note="Signed in and active" to="/admin/trainers" small />
        <Tile icon={MapPin} label="Centres" value={d.centres.active} to="/admin/centres" small />
        <Tile icon={Handshake} label="Training partners" value={d.partners.total} note={`${d.partners.verified} verified`} to="/admin/organisations?type=partner" small />
        <Tile icon={Building2} label="Employers" value={d.employers.total} note={`${d.employers.verified} verified`} to="/admin/organisations?type=employer" small />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={Briefcase} label="Open jobs" value={d.hiring.openJobs} note="Published, not past closing date" to="/admin/jobs?status=published" small />
        <Tile icon={ClipboardList} label="Applications" value={d.hiring.applications} note="All time" small />
        <Tile icon={Handshake} label="Joinings recorded" value={d.hiring.joinedRecorded} note={`${d.hiring.joinedVerified} confirmed by AutoTalent Grid`} to="/admin/outcomes?verification=" small />
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Needs your attention</h2>
        {tasks.length === 0 ? (
          <p className="mt-3 text-muted">Nothing is waiting. New candidates, trainers and organisations to verify appear here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
            {tasks.map((t) => (
              <li key={t.to}>
                <Link to={t.to} className="flex items-center gap-4 px-5 py-4 hover:bg-surface">
                  <span className="grid min-w-10 place-items-center rounded-lg bg-brand px-2 py-1 text-lg font-bold text-white">{t.n}</span>
                  <span className="font-medium">{t.label}</span>
                  <ArrowRight className="ml-auto size-5 text-brand" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-muted">&ldquo;Joinings recorded&rdquo; are reported by employers; only confirmed ones should be quoted as verified hiring outcomes.</p>
    </>
  );
}

function Tile({ icon: Icon, label, value, note, to, small = false }: { icon: typeof MapPin; label: string; value: number; note?: string; to?: string; small?: boolean }) {
  const body = (
    <>
      <Icon className="size-5 text-brand" aria-hidden />
      <p className={`mt-3 font-bold leading-none tracking-tight ${small ? 'text-[22px]' : 'text-[28px]'}`}>{value.toLocaleString('en-IN')}</p>
      <p className="mt-1.5 text-sm font-medium">{label}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card block px-5 py-4 transition-colors hover:border-brand">{body}</Link>
  ) : (
    <div className="card px-5 py-4">{body}</div>
  );
}
