import { Award, BookOpen, Briefcase, Building2, ClipboardCheck, GraduationCap, Handshake, History, LayoutDashboard, MapPin, UserCog, Users, UsersRound } from 'lucide-react';
import { Outlet } from 'react-router';
import { PortalLayout, type NavItem } from '../../components/PortalLayout';
import { useAuth } from '../../lib/auth';

export function AdminLayout() {
  const { can } = useAuth();
  // Order follows the design: training work first, platform administration after.
  const nav: NavItem[] = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
    ...(can('candidate.read') ? [{ to: '/admin/candidates', label: 'Candidates', icon: GraduationCap, bottom: true }] : []),
    ...(can('batch.read') ? [{ to: '/admin/batches', label: 'Batches', icon: UsersRound, bottom: true }] : []),
    ...(can('assessment.review') ? [{ to: '/admin/assessments', label: 'Assessment review', icon: ClipboardCheck }] : []),
    ...(can('credential.read') ? [{ to: '/admin/credentials', label: 'Certificates', icon: Award }] : []),
    ...(can('job.moderate') ? [{ to: '/admin/jobs', label: 'Jobs', icon: Briefcase }] : []),
    ...(can('hiring.read') ? [{ to: '/admin/outcomes', label: 'Hiring outcomes', icon: Handshake }] : []),
    ...(can('course.read') ? [{ to: '/admin/courses', label: 'Courses', icon: BookOpen, bottom: true }] : []),
    ...(can('trainer.read') ? [{ to: '/admin/trainers', label: 'Trainers', icon: UserCog }] : []),
    { to: '/admin/centres', label: 'Centres', icon: MapPin },
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
