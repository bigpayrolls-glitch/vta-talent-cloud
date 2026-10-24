import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, GraduationCap, Handshake, MapPin, UserCog } from 'lucide-react';
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
  awaitingAction: { usersPendingApproval: number; organisationsPendingVerification: number };
}
interface CentreDashboard {
  asOf: string;
  scope: 'centre';
  centres: { active: number };
}

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
        <div className="mt-8">
          <Tile icon={MapPin} label="Your active centres" value={q.data.centres.active} />
          <p className="mt-6 text-muted">Batch and trainer tools for centre admins arrive in Phase 2.</p>
        </div>
      )}
      {q.data && <p className="mt-8 text-sm text-muted">Counts as of {formatDate(q.data.asOf, true)}. Active accounts and organisations only.</p>}
    </div>
  );
}

function PlatformView({ d }: { d: PlatformDashboard }) {
  const tasks = [
    { n: d.awaitingAction.usersPendingApproval, label: d.awaitingAction.usersPendingApproval === 1 ? 'user waiting for approval' : 'users waiting for approval', to: '/admin/users?status=pending' },
    { n: d.awaitingAction.organisationsPendingVerification, label: d.awaitingAction.organisationsPendingVerification === 1 ? 'organisation waiting for verification' : 'organisations waiting for verification', to: '/admin/organisations?verificationStatus=pending' },
  ].filter((t) => t.n > 0);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile icon={GraduationCap} label="Learners" value={d.learners.active} />
        <Tile icon={UserCog} label="Trainers" value={d.trainers.active} />
        <Tile icon={Building2} label="Employers" value={d.employers.total} note={`${d.employers.verified} verified`} />
        <Tile icon={Handshake} label="Training partners" value={d.partners.total} note={`${d.partners.verified} verified`} />
        <Tile icon={MapPin} label="Centres" value={d.centres.active} />
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Needs your attention</h2>
        {tasks.length === 0 ? (
          <p className="mt-3 text-muted">Nothing is waiting. New sign-ups and organisations appear here.</p>
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

      <p className="mt-8 text-sm text-muted">Training, assessment and hiring figures join this dashboard as those features are built.</p>
    </>
  );
}

function Tile({ icon: Icon, label, value, note }: { icon: typeof MapPin; label: string; value: number; note?: string }) {
  return (
    <div className="card px-5 py-4">
      <Icon className="size-5 text-brand" aria-hidden />
      <p className="mt-3 text-[28px] font-bold leading-none tracking-tight">{value.toLocaleString('en-IN')}</p>
      <p className="mt-1.5 text-sm font-medium">{label}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
