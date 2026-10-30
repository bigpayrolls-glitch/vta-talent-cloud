import { useQuery } from '@tanstack/react-query';
import { BookOpen, Briefcase, Building2, ClipboardList, GraduationCap, Handshake, MapPin, UserCog, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorNote, formatDate, Spinner } from '../../components/ui';
import { HeroBanner, heroPrimary, heroSecondary, NextSteps, Panel, StatCard, StatRow } from '../../components/Showroom';
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
  const d = q.data;
  const waiting = d?.scope === 'platform' ? Object.values(d.awaitingAction).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <HeroBanner
        eyebrow="Admin portal · AutoTalent Grid"
        title={`Welcome, ${firstName(me?.name ?? '')}!`}
        subtitle={
          d?.scope === 'platform'
            ? `Manage the platform. ${waiting === 0 ? 'Nothing is waiting for you.' : `${waiting} ${plural(waiting, 'item is', 'items are')} waiting for you.`}`
            : 'Manage the platform.'
        }
        actions={
          d?.scope === 'platform' ? (
            <>
              <Link to="/admin/candidates" className={heroPrimary}>
                <GraduationCap className="size-4" aria-hidden />
                Review candidates
              </Link>
              <Link to="/admin/batches" className={heroSecondary}>
                <UsersRound className="size-4" aria-hidden />
                View batches
              </Link>
            </>
          ) : undefined
        }
        floating={!!d}
      />

      {q.isLoading && <Spinner />}
      {q.isError && <div className="mt-6"><ErrorNote message={(q.error as Error).message} /></div>}

      {d?.scope === 'platform' && <PlatformView d={d} />}
      {d?.scope === 'centre' && (
        <StatRow>
          <StatCard icon={MapPin} label="Your centres" value={d.centres.active} />
          <StatCard icon={UsersRound} label="Planned batches" value={d.batches.planned} to="/admin/batches?status=planned" />
          <StatCard icon={UsersRound} label="Active batches" value={d.batches.active} to="/admin/batches?status=active" highlight />
          <StatCard icon={UsersRound} label="Completed batches" value={d.batches.completed} to="/admin/batches?status=completed" />
        </StatRow>
      )}
      {d && <p className="mt-8 text-sm text-[#5B616E]">Counts as of {formatDate(d.asOf, true)}. Active accounts and organisations only.</p>}
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
  const n = (v: number) => v.toLocaleString('en-IN');

  return (
    <>
      <StatRow>
        <StatCard icon={GraduationCap} label="Candidates" value={n(t.candidatesTotal)} note={`${n(t.candidatesVerified)} verified`} to="/admin/candidates" />
        <StatCard icon={UsersRound} label="Active batches" value={n(t.batchesActive)} note={`${t.batchesPlanned} planned, ${t.batchesCompleted} completed`} to="/admin/batches?status=active" />
        <StatCard icon={ClipboardList} label="Enrolled now" value={n(t.enrolledInOpenBatches)} note="In planned and active batches" />
        <StatCard icon={BookOpen} label="Active courses" value={n(t.activeCourses)} to="/admin/courses?status=active" highlight />
      </StatRow>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="Network" id="adm-network">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MiniTile icon={UserCog} label="Trainers" value={n(d.trainers.active)} note="Signed in and active" to="/admin/trainers" />
              <MiniTile icon={MapPin} label="Centres" value={n(d.centres.active)} to="/admin/centres" />
              <MiniTile icon={Handshake} label="Training partners" value={n(d.partners.total)} note={`${d.partners.verified} verified`} to="/admin/organisations?type=partner" />
              <MiniTile icon={Building2} label="Employers" value={n(d.employers.total)} note={`${d.employers.verified} verified`} to="/admin/organisations?type=employer" />
            </div>
          </Panel>
          <Panel title="Hiring" id="adm-hiring">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <MiniTile icon={Briefcase} label="Open jobs" value={n(d.hiring.openJobs)} note="Published, not past closing date" to="/admin/jobs?status=published" />
              <MiniTile icon={ClipboardList} label="Applications" value={n(d.hiring.applications)} note="All time" />
              <MiniTile icon={Handshake} label="Joinings recorded" value={n(d.hiring.joinedRecorded)} note={`${d.hiring.joinedVerified} confirmed by AutoTalent Grid`} to="/admin/outcomes?verification=" />
            </div>
          </Panel>
        </div>
        <NextSteps
          title="Needs your attention"
          id="adm-attention"
          items={tasks.map((x) => ({ n: x.n, label: x.label, to: x.to }))}
          empty="Nothing is waiting. New candidates, trainers and organisations to verify appear here."
        />
      </div>

      <p className="mt-8 text-sm text-[#5B616E]">&ldquo;Joinings recorded&rdquo; are reported by employers; only confirmed ones should be quoted as verified hiring outcomes.</p>
    </>
  );
}

function MiniTile({ icon: Icon, label, value, note, to }: { icon: typeof MapPin; label: string; value: string; note?: string; to?: string }) {
  const body = (
    <>
      <span className="grid size-9 place-items-center rounded-[12px] bg-[#FDECED] text-[#C8101A]">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <p className="font-display mt-3 text-[24px] font-extrabold leading-none tracking-[-0.02em]">{value}</p>
      <p className="mt-1.5 text-sm font-semibold">{label}</p>
      {note && <p className="text-xs text-[#5B616E]">{note}</p>}
    </>
  );
  const cls = 'block min-w-0 rounded-[18px] border border-[#E3E6EA] p-4';
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-[#C8101A]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
