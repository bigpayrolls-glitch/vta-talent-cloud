import { Building2, History, LayoutDashboard, MapPin, Users } from 'lucide-react';
import { Outlet } from 'react-router';
import { PortalLayout, type NavItem } from '../../components/PortalLayout';
import { useAuth } from '../../lib/auth';

export function AdminLayout() {
  const { can } = useAuth();
  const nav: NavItem[] = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
    ...(can('user.read') ? [{ to: '/admin/users', label: 'Users', icon: Users, bottom: true }] : []),
    ...(can('organisation.manage') ? [{ to: '/admin/organisations', label: 'Organisations', icon: Building2, bottom: true }] : []),
    { to: '/admin/centres', label: 'Centres', icon: MapPin, bottom: true },
    ...(can('audit.read') ? [{ to: '/admin/audit', label: 'Audit log', icon: History, bottom: true }] : []),
  ];
  return (
    <PortalLayout portal="admin" nav={nav}>
      <Outlet />
    </PortalLayout>
  );
}
