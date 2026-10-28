import { useAuth } from '../../lib/auth';
import { PortalHomeContent } from '../PortalHomes';
import { PartnerDashboard } from './Courses';

/** /partner: the training partner's dashboard; a trainer (who has no partner role) sees their Today screen. */
export function PartnerHome() {
  const { me } = useAuth();
  const isPartner = !!me?.roles.some((r) => r.role === 'partner_admin');
  return isPartner ? <PartnerDashboard /> : <PortalHomeContent portal="partner" />;
}
