import { PORTAL_LABEL, ROLE_LABEL, type Portal } from '@vta/shared';
import {
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  Home,
  LayoutDashboard,
  Search,
  User,
  Users,
} from 'lucide-react';
import { PortalLayout, type NavItem } from '../components/PortalLayout';
import { firstName, useAuth } from '../lib/auth';

/**
 * Phase 1 placeholder homes for the three non-admin portals. They prove sign-in, role routing
 * and the responsive shell. Their features arrive in the phases listed on each screen.
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
    nav: [{ to: '/partner', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true }],
    coming: [
      { label: 'Batches and rosters', phase: 'Phase 2–3', icon: Users },
      { label: 'Attendance, including offline', phase: 'Phase 3–4', icon: CalendarCheck },
      { label: 'Assessments', phase: 'Phase 3', icon: FileText },
      { label: 'Programmes, beneficiaries and reports', phase: 'Phase 7', icon: BarChart3 },
    ],
  },
};

export function PortalHome({ portal }: { portal: Exclude<Portal, 'admin'> }) {
  const { me } = useAuth();
  const plan = PLANS[portal];
  const myRoles = me?.roles.filter((r) => (portal === 'learn' ? r.role === 'learner' : portal === 'employer' ? r.role.startsWith('employer') : ['partner_admin', 'partner_viewer', 'trainer'].includes(r.role))) ?? [];

  return (
    <PortalLayout portal={portal} nav={plan.nav}>
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
    </PortalLayout>
  );
}
