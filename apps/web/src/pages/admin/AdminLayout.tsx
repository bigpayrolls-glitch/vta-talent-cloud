import { Award, BadgeCheck, BarChart3, FolderKanban, BookOpen, Briefcase, Building2, ClipboardCheck, CreditCard, GraduationCap, Handshake, History, LayoutDashboard, MapPin, Ticket, UserCog, Users, UsersRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { api } from '../../lib/api';
import { PortalLayout, type NavItem } from '../../components/PortalLayout';
import { useAuth } from '../../lib/auth';

export function AdminLayout() {
  const { can } = useAuth();
  // Courses from training partners waiting for review: shown as a count next to "Course approvals".
  const pending = useQuery({
    queryKey: ['course-reviews', 'pending-count'],
    enabled: can('course.review'),
    queryFn: () => api.get<{ counts: Record<string, number> }>('/admin/course-reviews?pageSize=1'),
    refetchInterval: 120_000,
  });
  // Learners who paid for a career journey course and wait for a batch.
  const waiting = useQuery({
    queryKey: ['admin', 'bookings', 'awaiting_batch'],
    enabled: can('course.manage'),
    queryFn: () => api.get<{ items: unknown[] }>('/admin/bookings?status=awaiting_batch'),
    refetchInterval: 120_000,
  });
  // Order follows the design: training work first, platform administration after.
  const nav: NavItem[] = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
    ...(can('candidate.read') ? [{ to: '/admin/candidates', label: 'Candidates', icon: GraduationCap, bottom: true }] : []),
    ...(can('batch.read') ? [{ to: '/admin/batches', label: 'Batches', icon: UsersRound, bottom: true }] : []),
    ...(can('assessment.review') ? [{ to: '/admin/assessments', label: 'Assessment review', icon: ClipboardCheck }] : []),
    ...(can('credential.read') ? [{ to: '/admin/credentials', label: 'Certificates', icon: Award }] : []),
    ...(can('job.moderate') ? [{ to: '/admin/jobs', label: 'Jobs', icon: Briefcase }] : []),
    ...(can('hiring.read') ? [{ to: '/admin/outcomes', label: 'Hiring outcomes', icon: Handshake }] : []),
    ...(can('programme.manage') ? [{ to: '/admin/programmes', label: 'Programmes', icon: FolderKanban }] : []),
    ...(can('report.read') ? [{ to: '/admin/reports', label: 'Reports', icon: BarChart3 }] : []),
    ...(can('course.read') ? [{ to: '/admin/courses', label: 'Courses', icon: BookOpen, bottom: true }] : []),
    ...(can('course.manage') ? [{ to: '/admin/bookings', label: 'Course enrolments', icon: Ticket, badge: waiting.data?.items.length ?? 0 }] : []),
    ...(can('course.review') ? [{ to: '/admin/course-approvals', label: 'Course approvals', icon: BadgeCheck, badge: pending.data?.counts.submitted ?? 0 }] : []),
    ...(can('trainer.read') ? [{ to: '/admin/trainers', label: 'Trainers', icon: UserCog }] : []),
    { to: '/admin/centres', label: 'Centres', icon: MapPin },
    ...(can('subscription.manage') ? [{ to: '/admin/plans', label: 'Plans', icon: CreditCard }] : []),
    ...(can('organisation.manage') ? [{ to: '/admin/organisations', label: 'Organisations', icon: Building2 }] : []),
    ...(can('user.read') ? [{ to: '/admin/users', label: 'Users', icon: Users, bottom: true }] : []),
    ...(can('audit.read') ? [{ to: '/admin/audit', label: 'Audit log', icon: History }] : []),
  ];
  return (
    <PortalLayout portal="admin" nav={nav}>
      <Outlet />
    </PortalLayout>
  );
}
