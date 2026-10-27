import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reasonSchema, ROLE_LABEL, type Page, type Role } from '@vta/shared';
import { ArrowLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorNote, Field, formatDate, formatPhone, Modal, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../components/toast';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import type { AuditRow } from './Audit';
import { describeAudit } from './Audit';
import { emptyRole, roleBody, RolePicker } from './RolePicker';
import { useUserAction, type UserRow } from './Users';
import { ChangePhoneButton } from './ChangePhone';

interface UserDetailDto extends UserRow {
  inviteExpiresAt: string | null;
  roleAssignments: {
    id: string;
    role: Role;
    organisationName: string | null;
    centreName: string | null;
    grantedAt: string;
    grantedByName: string | null;
    revokedAt: string | null;
  }[];
}

type ActionKey = 'approve' | 'suspend' | 'reactivate' | 'deactivate' | 'resend-invitation';

const ACTIONS: Record<ActionKey, { label: string; done: string; reason: boolean; danger?: boolean; confirm: string }> = {
  approve: { label: 'Approve', done: 'User approved', reason: false, confirm: 'They will be able to sign in.' },
  suspend: { label: 'Suspend', done: 'User suspended', reason: true, danger: true, confirm: 'They are signed out at once and cannot sign in until reactivated.' },
  reactivate: { label: 'Reactivate', done: 'User reactivated', reason: false, confirm: 'They will be able to sign in again.' },
  deactivate: { label: 'Deactivate', done: 'User deactivated', reason: true, danger: true, confirm: 'This closes the account for good. Their records and history are kept.' },
  'resend-invitation': { label: 'Resend invitation', done: 'Invitation sent', reason: false, confirm: 'A new link is sent and the old one stops working.' },
};

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => api.get<UserDetailDto>(`/admin/users/${id}`) });
  const history = useQuery({
    queryKey: ['user', id, 'audit'],
    enabled: can('audit.read'),
    queryFn: () => api.get<Page<AuditRow>>(`/admin/audit-events${qs({ entityType: 'user', entityId: id, pageSize: 10 })}`),
  });
  const [action, setAction] = useState<ActionKey | null>(null);
  const [addRole, setAddRole] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const u = q.data!;
  const self = me?.id === u.id;

  const available: ActionKey[] = [];
  if (!self) {
    if (u.status === 'pending' && can('user.approve')) available.push('approve');
    if (u.status === 'invited' && u.email && can('user.invite')) available.push('resend-invitation');
    if (u.status === 'suspended' && can('user.suspend')) available.push('reactivate');
    if (['active', 'invited', 'pending'].includes(u.status) && can('user.suspend')) available.push('suspend');
    if (u.status !== 'deactivated' && can('user.deactivate')) available.push('deactivate');
  }

  const active = u.roleAssignments.filter((r) => !r.revokedAt);
  const past = u.roleAssignments.filter((r) => r.revokedAt);

  return (
    <div>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All users
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{u.name}</h1>
            <StatusBadge status={u.status} />
          </div>
          <p className="mt-1 text-muted">
            {[u.email, formatPhone(u.phone)].filter(Boolean).join(', ')}
            <ChangePhoneButton userId={u.id} name={u.name} phone={u.phone} className="ml-2 text-sm font-medium text-brand hover:underline" />
          </p>
          <p className="mt-1 text-sm text-muted">
            Added {formatDate(u.createdAt)}. {u.lastLoginAt ? `Last signed in ${formatDate(u.lastLoginAt, true)}.` : 'Has not signed in yet.'}
            {u.inviteExpiresAt && ` Invitation link valid until ${formatDate(u.inviteExpiresAt)}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {available.map((a) => (
            <button key={a} className={ACTIONS[a].danger ? 'btn-secondary text-brand' : a === 'approve' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAction(a)}>
              {ACTIONS[a].label}
            </button>
          ))}
        </div>
      </div>
      {self && <p className="mb-6 rounded-lg bg-surface px-4 py-3 text-sm text-muted">This is your own account. Another administrator must change its status.</p>}
      <ClosureRequest userId={u.id} />

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">Roles</h2>
          {can('role.assign') && u.status !== 'deactivated' && (
            <button className="btn-quiet btn-sm" onClick={() => setAddRole(true)}>
              <Plus className="size-4" aria-hidden />
              Add role
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <EmptyState title="No roles" body="Without a role this person can sign in but cannot open any portal." />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((r) => (
              <RoleRow key={r.id} r={r} canRevoke={can('role.assign')} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-muted">Removed roles ({past.length})</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {past.map((r) => (
                <li key={r.id}>
                  {ROLE_LABEL[r.role]}
                  {r.organisationName && `, ${r.organisationName}`}
                  {r.centreName && `, ${r.centreName}`} — removed {formatDate(r.revokedAt)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {can('audit.read') && (
        <section className="card mt-6 overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 font-semibold">Recent activity</h2>
          {history.data?.items.length ? (
            <ul className="divide-y divide-line text-sm">
              {history.data.items.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                  <span>
                    {describeAudit(e)} <span className="text-muted">by {e.actorName ?? 'the system'}</span>
                  </span>
                  <span className="text-muted">{formatDate(e.createdAt, true)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" />
          )}
        </section>
      )}

      {action && <ActionModal action={action} user={u} onClose={() => setAction(null)} />}
      <AddRoleModal open={addRole} userId={u.id} onClose={() => setAddRole(false)} />
    </div>
  );
}

function RoleRow({ r, canRevoke }: { r: UserDetailDto['roleAssignments'][number]; canRevoke: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const act = useUserAction();
  const toast = useToast();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div>
        <p className="font-medium">{ROLE_LABEL[r.role]}</p>
        <p className="text-sm text-muted">
          {[r.organisationName, r.centreName].filter(Boolean).join(', ') || 'Platform-wide'}. Given {formatDate(r.grantedAt)}
          {r.grantedByName ? ` by ${r.grantedByName}` : ''}
        </p>
      </div>
      {canRevoke && (
        <button className="btn-secondary btn-sm" onClick={() => setConfirm(true)}>
          Remove
        </button>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove this role?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(
                  { path: `/admin/role-assignments/${r.id}/revoke` },
                  {
                    onSuccess: () => {
                      toast('success', 'Role removed');
                      setConfirm(false);
                    },
                    onError: (e) => toast('error', (e as Error).message),
                  },
                )
              }
            >
              Remove role
            </button>
          </>
        }
      >
        <p className="text-sm">
          {ROLE_LABEL[r.role]} access ends on their next request. The change is recorded in the audit log.
        </p>
      </Modal>
    </li>
  );
}

function ActionModal({ action, user, onClose }: { action: ActionKey; user: UserDetailDto; onClose: () => void }) {
  const a = ACTIONS[action];
  const toast = useToast();
  const qc = useQueryClient();
  const f = useForm(a.reason ? reasonSchema : reasonSchema.partial());
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`${a.label} ${user.name}?`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" form="action-form" type="submit" disabled={f.submitting}>
            {a.label}
          </button>
        </>
      }
    >
      <form
        id="action-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(a.reason ? { reason } : {}, async (data) => {
            await api.post(`/admin/users/${user.id}/${action}`, data);
            await qc.invalidateQueries({ queryKey: ['user'] });
            await qc.invalidateQueries({ queryKey: ['users'] });
            await qc.invalidateQueries({ queryKey: ['dashboard'] });
            toast('success', a.done);
            onClose();
          });
        }}
      >
        <p className="text-sm">{a.confirm}</p>
        {f.formError && <ErrorNote message={f.formError} />}
        {a.reason && (
          <Field label="Reason" htmlFor="reason" error={f.errors.reason} hint="Saved in the audit log.">
            <textarea id="reason" rows={3} className="field-input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

function AddRoleModal({ open, userId, onClose }: { open: boolean; userId: string; onClose: () => void }) {
  const [role, setRole] = useState(emptyRole);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const act = useUserAction();
  const toast = useToast();
  const close = () => {
    setRole(emptyRole);
    setErrors({});
    setFormError('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add role"
      footer={
        <>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={act.isPending}
            onClick={() => {
              if (!role.role) {
                setErrors({ role: 'Choose a role' });
                return;
              }
              act.mutate(
                { path: '/admin/role-assignments', body: { userId, ...roleBody(role) } },
                {
                  onSuccess: () => {
                    toast('success', 'Role added');
                    close();
                  },
                  onError: (e) => {
                    const err = e as { fields?: Record<string, string>; message: string };
                    setErrors(err.fields ?? {});
                    setFormError(err.message);
                  },
                },
              );
            }}
          >
            Add role
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <ErrorNote message={formError} />}
        <RolePicker value={role} onChange={setRole} errors={errors} />
      </div>
    </Modal>
  );
}

interface AccountRequestRow {
  id: string;
  reason: string | null;
  createdAt: string;
}

/** Phase 9: a learner's open request to close their account. Only an Admin can complete or decline it. */
function ClosureRequest({ userId }: { userId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['account-requests', userId], queryFn: () => api.get<{ items: AccountRequestRow[] }>(`/admin/account-requests${qs({ userId })}`) });
  const [mode, setMode] = useState<null | 'complete' | 'decline'>(null);
  const [note, setNote] = useState('');
  const f = useForm(reasonSchema);
  const r = q.data?.items[0];
  if (!r) return null;
  const close = () => {
    setMode(null);
    setNote('');
  };
  return (
    <section className="mb-6 rounded-xl border border-warning/30 bg-warning-tint px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-warning">Asked to close their account</h2>
          <p className="mt-1 text-sm">
            On {formatDate(r.createdAt)}. {r.reason ? <>Reason: &ldquo;{r.reason}&rdquo;</> : 'No reason given.'} Their profile is already out of employer search.
          </p>
          {!can('user.deactivate') && <p className="mt-1 text-sm text-muted">An Admin completes or declines it.</p>}
        </div>
        {can('user.deactivate') && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setMode('decline')}>Decline</button>
            <button type="button" className="btn-primary" onClick={() => setMode('complete')}>Close account</button>
          </div>
        )}
      </div>
      <Modal
        open={mode !== null}
        onClose={close}
        title={mode === 'complete' ? 'Close this account?' : 'Decline the request?'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              disabled={f.submitting}
              onClick={() =>
                void f.submit(mode === 'decline' ? { reason: note } : { reason: note || 'Closed at the learner’s request' }, async (data) => {
                  await api.post(`/admin/account-requests/${r.id}/${mode}`, data);
                  await qc.invalidateQueries({ queryKey: ['account-requests'] });
                  await qc.invalidateQueries({ queryKey: ['user', userId] });
                  toast('success', mode === 'complete' ? 'Account closed' : 'Request declined');
                  close();
                })
              }
            >
              {mode === 'complete' ? 'Close account' : 'Decline'}
            </button>
          </>
        }
      >
        {mode === 'complete' ? (
          <p className="text-sm">They are signed out and can no longer sign in, and any open job applications are withdrawn. Training records and certificates are kept.</p>
        ) : (
          <p className="text-sm">Their account stays open. Tell them why, for example by phone.</p>
        )}
        {f.formError && <div className="mt-3"><ErrorNote message={f.formError} /></div>}
        <div className="mt-4">
          <Field label={mode === 'decline' ? 'Reason' : 'Note (optional)'} htmlFor="closure-note" error={f.errors.reason}>
            <textarea id="closure-note" className="field-input min-h-20" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </section>
  );
}
