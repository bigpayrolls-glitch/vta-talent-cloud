import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, ROLE_SCOPE, ROLES, type Page, type Role } from '@vta/shared';
import { Field } from '../../components/ui';
import { api, qs } from '../../lib/api';

export interface RoleValue {
  role: Role | '';
  organisationId: string;
  centreId: string;
}

export const emptyRole: RoleValue = { role: '', organisationId: '', centreId: '' };

/** Picks a role and exactly the scope that role needs (organisation, centre, or both). */
export function RolePicker({ value, onChange, errors = {}, prefix = '' }: { value: RoleValue; onChange: (v: RoleValue) => void; errors?: Record<string, string>; prefix?: string }) {
  const rule = value.role ? ROLE_SCOPE[value.role] : null;
  const orgs = useQuery({
    queryKey: ['orgs-for-role', rule?.organisation],
    enabled: !!rule?.organisation,
    queryFn: () => api.get<Page<{ id: string; legalName: string; verificationStatus: string }>>(`/admin/organisations${qs({ type: rule!.organisation!, pageSize: 100 })}`),
  });
  const centres = useQuery({
    queryKey: ['centres-for-role', value.role, value.organisationId],
    enabled: !!rule?.centre && (!rule.organisation || !!value.organisationId),
    queryFn: () =>
      api.get<Page<{ id: string; name: string; city: string | null; organisationId: string | null }>>(
        `/centres${qs({ status: 'active', pageSize: 100, organisationId: value.role === 'trainer' ? value.organisationId : undefined })}`,
      ),
  });
  const err = (k: string) => errors[`${prefix}${k}`];

  return (
    <div className="space-y-4">
      <Field label="Role" htmlFor="role" error={err('role')}>
        <select id="role" className="field-input" value={value.role} onChange={(e) => onChange({ role: e.target.value as Role, organisationId: '', centreId: '' })}>
          <option value="">Choose a role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      {rule?.organisation && (
        <Field label={rule.organisation === 'employer' ? 'Employer' : 'Training partner'} htmlFor="organisationId" error={err('organisationId')}>
          <select id="organisationId" className="field-input" value={value.organisationId} onChange={(e) => onChange({ ...value, organisationId: e.target.value, centreId: '' })}>
            <option value="">{orgs.isLoading ? 'Loading…' : 'Choose an organisation'}</option>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.legalName}
                {o.verificationStatus !== 'verified' ? ` (${o.verificationStatus.replace(/_/g, ' ')})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      {rule?.centre && (!rule.organisation || value.organisationId) && (
        <Field label="Centre" htmlFor="centreId" error={err('centreId')} hint={value.role === 'trainer' ? 'Only centres run by this training partner are listed.' : undefined}>
          <select id="centreId" className="field-input" value={value.centreId} onChange={(e) => onChange({ ...value, centreId: e.target.value })}>
            <option value="">{centres.isLoading ? 'Loading…' : centres.data?.items.length === 0 ? 'No active centres' : 'Choose a centre'}</option>
            {centres.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.city ? `, ${c.city}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

export function roleBody(v: RoleValue) {
  if (!v.role) return undefined;
  return { role: v.role, organisationId: v.organisationId || undefined, centreId: v.centreId || undefined };
}
