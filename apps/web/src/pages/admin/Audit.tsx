import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, type Page, type Role } from '@vta/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNote, Field, formatDate, PageHeader, Pagination, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';

export interface AuditRow {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const ACTION_TEXT: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.locked': 'Locked after failed sign-ins',
  'user.invited': 'Invited',
  'user.invitation_resent': 'Invitation resent',
  'user.invitation_accepted': 'Accepted invitation',
  'user.activated': 'Activated by first sign-in',
  'user.approved': 'Approved',
  'user.suspended': 'Suspended',
  'user.reactivated': 'Reactivated',
  'user.deactivated': 'Deactivated',
  'role.granted': 'Role given',
  'role.revoked': 'Role removed',
  'organisation.created': 'Organisation added',
  'organisation.verified': 'Organisation verified',
  'organisation.rejected': 'Organisation rejected',
  'organisation.more_info_needed': 'More information requested',
  'centre.created': 'Centre added',
  'centre.updated': 'Centre edited',
  'centre.deactivated': 'Centre deactivated',
  'centre.activated': 'Centre reactivated',
};

export function describeAudit(e: AuditRow): string {
  const base = ACTION_TEXT[e.action] ?? e.action;
  const role = (e.after?.role ?? e.before?.role) as Role | undefined;
  return role ? `${base}: ${ROLE_LABEL[role] ?? role}` : base;
}

const FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'auth.', label: 'Sign-ins' },
  { value: 'user.', label: 'User changes' },
  { value: 'role.', label: 'Role changes' },
  { value: 'organisation.', label: 'Organisation changes' },
  { value: 'centre.', label: 'Centre changes' },
];

function Changes({ e }: { e: AuditRow }) {
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])].filter((k) => !['assignmentId', 'id'].includes(k));
  if (!keys.length) return <p className="text-muted">No field changes recorded.</p>;
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table className="w-full text-[13px]">
      <thead className="text-muted">
        <tr>
          <th className="py-1 pr-4 text-left font-medium">Field</th>
          <th className="py-1 pr-4 text-left font-medium">Before</th>
          <th className="py-1 text-left font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="align-top">
            <td className="py-1 pr-4 font-medium">{k}</td>
            <td className="py-1 pr-4 break-all text-muted">{show(e.before?.[k])}</td>
            <td className="py-1 break-all">{show(e.after?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const filters = { action: params.get('action') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const page = Number(params.get('page') ?? 1);
  const q = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.get<Page<AuditRow>>(`/admin/audit-events${qs({ ...filters, page, pageSize: 25 })}`),
    placeholderData: (p) => p,
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };

  return (
    <div>
      <PageHeader title="Audit log" description="Every sensitive change, who made it and when. Entries cannot be edited or deleted." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Action" htmlFor="a-action">
          <select id="a-action" className="field-input" value={filters.action} onChange={(e) => set('action', e.target.value)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="a-from">
          <input id="a-from" type="date" className="field-input" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <Field label="To" htmlFor="a-to">
          <input id="a-to" type="date" className="field-input" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </Field>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No entries for these filters" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((e) => (
                <li key={e.id}>
                  <button
                    className="grid w-full gap-1 px-5 py-3.5 text-left text-sm hover:bg-surface/60 sm:grid-cols-[170px_1fr_1fr] sm:gap-4"
                    aria-expanded={open === e.id}
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                  >
                    <span className="text-muted">{formatDate(e.createdAt, true)}</span>
                    <span className="font-medium">{describeAudit(e)}</span>
                    <span>
                      {e.entityLabel ?? e.entityType}
                      {e.actorId !== e.entityId && <span className="text-muted"> by {e.actorName ?? 'the system'}</span>}
                    </span>
                  </button>
                  {open === e.id && (
                    <div className="bg-surface/50 px-5 pb-4 pt-2">
                      <Changes e={e} />
                      <p className="mt-2 text-xs text-muted">Request ID {e.requestId ?? '—'}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
          </>
        )}
      </div>
    </div>
  );
}
