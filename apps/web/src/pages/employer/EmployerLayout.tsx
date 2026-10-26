import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, LayoutDashboard, Search, Users } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { PortalLayout, type NavItem } from '../../components/PortalLayout';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export interface Company {
  id: string;
  legalName: string;
  sector: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  description: string | null;
  gstin: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'more_info_needed';
  verificationReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  identityLocked: boolean;
  possibleDuplicate: boolean;
}

export const useCompany = () => useQuery({ queryKey: ['employer', 'company'], queryFn: () => api.get<Company>('/employer/company') });

/** Employer portal (responsive web). Until VTA verifies the company, a banner explains what is needed. */
export function EmployerLayout() {
  const { can } = useAuth();
  const company = useCompany();
  const location = useLocation();
  const nav: NavItem[] = [
    { to: '/employer', label: 'Dashboard', icon: LayoutDashboard, bottom: true, end: true },
    { to: '/employer/jobs', label: 'Jobs', icon: Briefcase, bottom: true },
    { to: '/employer/candidates', label: 'Candidates', icon: Search, bottom: true },
    { to: '/employer/company', label: 'Company', icon: Building2, bottom: true },
    ...(can('employer.company') ? [{ to: '/employer/team', label: 'Team', icon: Users }] : []),
  ];
  const c = company.data;
  const showBanner = c && c.verificationStatus !== 'verified' && !location.pathname.startsWith('/employer/company');
  return (
    <PortalLayout portal="employer" nav={nav}>
      {showBanner && (
        <p role="status" className="mb-5 rounded-xl bg-warning-tint px-4 py-3 text-sm text-warning">
          {c.verificationStatus === 'more_info_needed'
            ? `VTA needs more information: ${c.verificationReason ?? ''} `
            : c.verificationStatus === 'rejected'
              ? 'VTA could not verify your company. Contact VTA to discuss it. '
              : c.submittedAt
                ? 'VTA is checking your company. You can prepare job drafts meanwhile; publishing and candidate search open once it is verified. '
                : 'Complete your company profile and send it to VTA for checking before you can publish jobs or search candidates. '}
          <Link to="/employer/company" className="font-semibold underline">
            Company profile
          </Link>
        </p>
      )}
      <Outlet />
    </PortalLayout>
  );
}
