import { ROLE_LABEL } from '@vta/shared';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarCheck,
  LayoutDashboard,
  RefreshCw,
  UserCog,
  Users,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, Outlet } from 'react-router';
import { PortalLayout, type NavItem } from '../components/PortalLayout';
import { firstName, useAuth } from '../lib/auth';
import { refreshSnapshot, startAutoSync } from '../offline/sync';
import { useOffline } from '../offline/useOffline';
import { InstallCard } from './trainer/InstallCard';
import { SyncIndicator } from './trainer/SyncIndicator';

/** Training Partner portal home: partners see programmes and batches; trainers also see Today. */
const PLANS = {
  partner: {
    greeting: 'Manage your training programmes.',
    nav: [
      { to: '/partner', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
      { to: '/partner/batches', label: 'Batches', icon: Users, bottom: true },
    ] as NavItem[],
  },
};

/** Training Partner portal: shared layout around the home, batches and batch pages. Trainers also get offline sync. */
export function PartnerLayout() {
  const { me } = useAuth();
  const isTrainer = !!me?.roles.some((r) => r.role === 'trainer');
  useEffect(() => {
    if (isTrainer) startAutoSync();
  }, [isTrainer]);
  const isPartner = !!me?.roles.some((r) => r.role === 'partner_admin');
  // Five logins (27 Oct 2026): a training partner runs everything for its own centres, including trainers.
  const nav: NavItem[] = [
    PLANS.partner.nav[0]!,
    ...(isPartner ? [{ to: '/partner/programmes', label: 'Programmes', icon: BarChart3, bottom: true }] : []),
    PLANS.partner.nav[1]!,
    ...(isPartner ? [{ to: '/partner/trainers', label: 'Trainers', icon: UserCog, bottom: true }] : []),
    ...(isTrainer ? [{ to: '/partner/sync', label: 'Sync', icon: RefreshCw, bottom: true }] : []),
    ...(isPartner ? [{ to: '/partner/organisation', label: 'Organisation', icon: Building2 }] : []),
  ];
  return (
    <PortalLayout portal="partner" nav={nav} headerExtra={isTrainer ? <SyncIndicator /> : undefined}>
      <Outlet />
    </PortalLayout>
  );
}

export function PortalHomeContent({ portal }: { portal: 'partner' }) {
  const { me } = useAuth();
  const plan = PLANS[portal];
  const myRoles = me?.roles.filter((r) => ['partner_admin', 'trainer'].includes(r.role)) ?? [];

  return (
    <>
      <section className="rounded-[20px] bg-brand-tint px-6 py-8 sm:px-10 sm:py-10">
        <h1 className="text-[30px] font-extrabold tracking-tight sm:text-[36px]">Hello, {firstName(me?.name ?? '')}!</h1>
        <p className="mt-1 text-lg text-ink/75">{plan.greeting}</p>
        {myRoles.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2">
            {myRoles.map((r) => (
              <li key={r.id} className="rounded-full bg-white px-3 py-1 text-sm font-medium">
                {ROLE_LABEL[r.role]}
                {r.organisationName && <span className="text-muted">, {r.organisationName}</span>}
                {r.centreName && <span className="text-muted">, {r.centreName}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {portal === 'partner' && me?.roles.some((r) => r.role === 'trainer' && !r.centreName) && !me.roles.some((r) => r.role === 'trainer' && r.centreName) && (
        <p className="card mt-6 px-5 py-4 text-sm">
          <span className="font-semibold">You are an independent trainer.</span> AutoTalent Grid checks your details first. Once you are verified, training partners can give you batches,
          and they appear here.
        </p>
      )}
      {portal === 'partner' && me?.roles.some((r) => r.role === 'trainer') && (
        <>
          <TrainerToday />
          <InstallCard />
        </>
      )}

      {myRoles.some((r) => r.role !== 'trainer') && (
        <Link to="/partner/programmes" className="card mt-6 flex items-center gap-4 px-5 py-4 hover:border-brand">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
            <BarChart3 className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Programmes</span>
            <span className="block text-sm text-muted">Progress against targets, beneficiaries, documents and reports</span>
          </span>
          <ArrowRight className="size-5 text-brand" aria-hidden />
        </Link>
      )}

      {portal === 'partner' && (
        <Link to="/partner/batches" className="card mt-6 flex items-center gap-4 px-5 py-4 hover:border-brand">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
            <Users className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Batches and rosters</span>
            <span className="block text-sm text-muted">Batches, attendance, assessments and who is enrolled</span>
          </span>
          <ArrowRight className="size-5 text-brand" aria-hidden />
        </Link>
      )}

    </>
  );
}

/** For trainers: their running batches, from the copy kept on the phone (so it works offline). */
function TrainerToday() {
  const off = useOffline();
  useEffect(() => {
    void refreshSnapshot();
  }, []);
  if (!off.ready) return null;
  return (
    <section className="mt-6">
      <h2 className="text-xl font-bold">Today</h2>
      {off.batches.length === 0 ? (
        <p className="card mt-3 px-5 py-4 text-sm text-muted">
          {off.online ? 'No running batches assigned to you.' : 'You are offline and no batches are stored on this phone yet. Open the app once while connected.'}
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {off.batches.map((b) => {
            const waiting = off.ops.filter((o) => o.batchId === b.id).length;
            return (
              <li key={b.id} className="card flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{b.name}</span>
                  <span className="block text-sm text-muted">
                    {b.centreName}, {b.people.length} enrolled
                    {waiting > 0 && `, ${waiting} not synced`}
                  </span>
                </span>
                <Link to={`/partner/attendance/${b.id}`} className="btn-primary btn-sm">
                  <CalendarCheck className="size-4" aria-hidden />
                  Take attendance
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
