import { PORTAL_LABEL, ROLE_LABEL, type Portal } from '@vta/shared';
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarCheck,
  ClipboardCheck,
  Home,
  LayoutDashboard,
  Search,
  User,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from 'react-router';
import { api } from '../lib/api';
import { PortalLayout, type NavItem } from '../components/PortalLayout';
import { firstName, useAuth } from '../lib/auth';

/**
 * Homes for the three non-admin portals. The Training Partner portal has batches and rosters
 * from Phase 2; the rest of each portal arrives in the phases listed on screen.
 */
interface PortalPlan {
  greeting: string;
  nav: NavItem[];
  coming: { label: string; phase: string; icon: typeof Home }[];
}

const PLANS: Record<Exclude<Portal, 'admin'>, PortalPlan> = {
  learn: {
    greeting: 'Keep learning. Build your career.',
    nav: [{ to: '/learn', label: 'Home', icon: Home, bottom: true, end: true }],
    coming: [
      { label: 'My profile and privacy choices', phase: 'Phase 5', icon: User },
      { label: 'My courses and learning progress', phase: 'Phase 5', icon: BookOpen },
      { label: 'Assessment results and certificates', phase: 'Phase 5', icon: Award },
      { label: 'Find jobs and track applications', phase: 'Phase 5', icon: Briefcase },
    ],
  },
  employer: {
    greeting: 'Find skilled and certified technicians.',
    nav: [{ to: '/employer', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true }],
    coming: [
      { label: 'Company profile and team access', phase: 'Phase 6', icon: Users },
      { label: 'Post a job', phase: 'Phase 6', icon: Briefcase },
      { label: 'Find candidates', phase: 'Phase 6', icon: Search },
      { label: 'Applications, interviews and hiring outcomes', phase: 'Phase 6', icon: ClipboardCheck },
    ],
  },
  partner: {
    greeting: 'Manage your training programmes.',
    nav: [
      { to: '/partner', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
      { to: '/partner/batches', label: 'Batches', icon: Users, bottom: true },
    ],
    coming: [
      { label: 'Attendance without a connection', phase: 'Phase 4', icon: CalendarCheck },
      { label: 'Programmes, beneficiaries and reports', phase: 'Phase 7', icon: BarChart3 },
    ],
  },
};

export function PortalHome({ portal }: { portal: Exclude<Portal, 'admin'> }) {
  return (
    <PortalLayout portal={portal} nav={PLANS[portal].nav}>
      <PortalHomeContent portal={portal} />
    </PortalLayout>
  );
}

/** Training Partner portal: shared layout around the home, batches and batch pages. */
export function PartnerLayout() {
  return (
    <PortalLayout portal="partner" nav={PLANS.partner.nav}>
      <Outlet />
    </PortalLayout>
  );
}

export function PortalHomeContent({ portal }: { portal: Exclude<Portal, 'admin'> }) {
  const { me } = useAuth();
  const plan = PLANS[portal];
  const myRoles = me?.roles.filter((r) => (portal === 'learn' ? r.role === 'learner' : portal === 'employer' ? r.role.startsWith('employer') : ['partner_admin', 'partner_viewer', 'trainer'].includes(r.role))) ?? [];

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

      {portal === 'partner' && me?.roles.some((r) => r.role === 'trainer') && <TrainerToday />}

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

      <section className="mt-8">
        <h2 className="text-xl font-bold">Coming to the {PORTAL_LABEL[portal]}</h2>
        <p className="mt-1 text-muted">Your sign-in works today. These tools are being built next.</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {plan.coming.map((c) => (
            <li key={c.label} className="card flex items-center gap-4 px-5 py-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-ink">
                <c.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{c.label}</span>
                <span className="block text-sm text-muted">{c.phase}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** For trainers: today's active batches with a direct way into attendance. */
function TrainerToday() {
  const q = useQuery({
    queryKey: ['batches', 'trainer-today'],
    queryFn: () => api.get<{ items: { id: string; name: string; centre: { name: string }; enrolled: number }[] }>('/batches?status=active&pageSize=10'),
  });
  if (!q.data?.items.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-xl font-bold">Today</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {q.data.items.map((b) => (
          <li key={b.id} className="card flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{b.name}</span>
              <span className="block text-sm text-muted">{b.centre.name}, {b.enrolled} enrolled</span>
            </span>
            <Link to={`/partner/batches/${b.id}?tab=attendance`} className="btn-primary btn-sm">Take attendance</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
