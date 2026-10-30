import { ROLE_LABEL } from '@vta/shared';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CreditCard,
  LayoutDashboard,
  RefreshCw,
  UserCog,
  Users,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, Outlet } from 'react-router';
import { PortalLayout, type NavItem } from '../components/PortalLayout';
import { HeroBanner, Panel, StatCard, StatRow } from '../components/Showroom';
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
    ...(isPartner ? [{ to: '/partner/courses', label: 'Courses', icon: BookOpen, bottom: true }] : []),
    ...(isPartner ? [{ to: '/partner/programmes', label: 'Programmes', icon: BarChart3 }] : []),
    PLANS.partner.nav[1]!,
    ...(isPartner ? [{ to: '/partner/trainers', label: 'Trainers', icon: UserCog, bottom: true }] : []),
    ...(isTrainer ? [{ to: '/partner/sync', label: 'Sync', icon: RefreshCw, bottom: true }] : []),
    ...(isPartner ? [{ to: '/partner/organisation', label: 'Organisation', icon: Building2 }] : []),
    ...(isPartner ? [{ to: '/partner/subscription', label: 'Subscription & Billing', icon: CreditCard }] : []),
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
  const isTrainer = !!me?.roles.some((r) => r.role === 'trainer');

  return (
    <>
      <HeroBanner eyebrow={isTrainer ? 'Trainer · AutoTalent Grid' : 'Training partner'} title={`Hello, ${firstName(me?.name ?? '')}!`} subtitle={plan.greeting} floating={isTrainer}>
        {myRoles.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {myRoles.map((r) => (
              <li key={r.id} className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
                {ROLE_LABEL[r.role]}
                {r.organisationName && <span className="text-white/70">, {r.organisationName}</span>}
                {r.centreName && <span className="text-white/70">, {r.centreName}</span>}
              </li>
            ))}
          </ul>
        )}
      </HeroBanner>

      {isTrainer && <TrainerStats />}

      {me?.roles.some((r) => r.role === 'trainer' && !r.centreName) && !me.roles.some((r) => r.role === 'trainer' && r.centreName) && (
        <p className="mt-6 rounded-[22px] bg-white px-5 py-4 text-sm">
          <span className="font-semibold">You are an independent trainer.</span> AutoTalent Grid checks your details first. Once you are verified, training partners can give you batches,
          and they appear here.
        </p>
      )}
      {isTrainer && (
        <>
          <TrainerToday />
          <InstallCard />
        </>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {myRoles.some((r) => r.role !== 'trainer') && (
          <HomeLink to="/partner/programmes" icon={BarChart3} title="Programmes" body="Progress against targets, beneficiaries, documents and reports" />
        )}
        <HomeLink to="/partner/batches" icon={Users} title="Batches and rosters" body="Batches, attendance, assessments and who is enrolled" />
      </div>
    </>
  );
}

function HomeLink({ to, icon: Icon, title, body }: { to: string; icon: typeof Users; title: string; body: string }) {
  return (
    <Link to={to} className="flex items-center gap-4 rounded-[22px] bg-white px-5 py-5 transition-transform hover:-translate-y-0.5">
      <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[#C8101A] text-white">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-display block text-[16px] font-bold">{title}</span>
        <span className="block text-sm text-[#5B616E]">{body}</span>
      </span>
      <ArrowRight className="size-5 text-[#C8101A]" aria-hidden />
    </Link>
  );
}

/** Numbers from the copy kept on the phone, so they show offline too. */
function TrainerStats() {
  const off = useOffline();
  const learners = off.batches.reduce((n, b) => n + b.people.length, 0);
  return (
    <StatRow cols={3}>
      <StatCard icon={Users} label="Running batches" value={off.ready ? off.batches.length : '…'} />
      <StatCard icon={UserCog} label="Learners" value={off.ready ? learners : '…'} note="In your running batches" />
      <StatCard icon={RefreshCw} label="Not synced" value={off.ready ? off.unsynced : '…'} note={off.online ? 'Online' : 'Offline'} highlight={off.unsynced > 0} />
    </StatRow>
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
    <Panel title="Today" id="tr-today" className="mt-6">
      {off.batches.length === 0 ? (
        <p className="text-sm text-[#5B616E]">
          {off.online ? 'No running batches assigned to you.' : 'You are offline and no batches are stored on this phone yet. Open the app once while connected.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {off.batches.map((b) => {
            const waiting = off.ops.filter((o) => o.batchId === b.id).length;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[#E3E6EA] px-4 py-4">
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
    </Panel>
  );
}
