import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailSchema, nameSchema, phoneSchema, ROLE_LABEL, ROLES, type Page, type Role } from '@vta/shared';
import { Copy, Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { EmptyState, ErrorNote, Field, formatDate, formatPhone, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../components/toast';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { emptyRole, roleBody, RolePicker, type RoleValue } from './RolePicker';

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  roles: Role[];
  lastLoginAt: string | null;
  createdAt: string;
}

const STATUSES = ['active', 'invited', 'pending', 'suspended', 'deactivated'];

export function UsersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [inviteOpen, setInviteOpen] = useState(false);
  const page = Number(params.get('page') ?? 1);
  const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', role: params.get('role') ?? '' };

  const q = useQuery({
    queryKey: ['users', filters, page],
    queryFn: () => api.get<Page<UserRow>>(`/admin/users${qs({ ...filters, page, pageSize: 20 })}`),
    placeholderData: (prev) => prev,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  return (
    <div>
      <PageHeader
        title="Users"
        description="Invite people, approve sign-ups and manage access."
        actions={
          can('user.invite') && (
            <button className="btn-primary" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" aria-hidden />
              Invite user
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <form
          className="relative flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('q', search.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="user-search" className="sr-only">
            Search users
          </label>
          <input id="user-search" className="field-input pl-9" placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <div className="flex gap-3">
          <label className="sr-only" htmlFor="status-filter">
            Status
          </label>
          <select id="status-filter" className="field-input md:w-40" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="role-filter">
            Role
          </label>
          <select id="role-filter" className="field-input md:w-48" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No users match" body="Try a different search or clear the filters." />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-line bg-surface/60 text-[13px] text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Roles</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data!.items.map((u) => (
                  <tr key={u.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3">
                      <Link to={`/admin/users/${u.id}`} className="font-semibold hover:text-brand">
                        {u.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email ?? formatPhone(u.phone)}</td>
                    <td className="px-4 py-3">{u.roles.length ? u.roles.map((r) => ROLE_LABEL[r]).join(', ') : <span className="text-muted">No role</span>}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {q.data!.items.map((u) => (
                <li key={u.id}>
                  <Link to={`/admin/users/${u.id}`} className="block px-4 py-3.5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{u.name}</span>
                      <StatusBadge status={u.status} />
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{u.email ?? formatPhone(u.phone)}</span>
                    <span className="mt-0.5 block text-sm">{u.roles.map((r) => ROLE_LABEL[r]).join(', ') || 'No role'}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={q.data!.page}
              pageSize={q.data!.pageSize}
              total={q.data!.total}
              onPage={(p) => {
                const next = new URLSearchParams(params);
                next.set('page', String(p));
                setParams(next);
              }}
            />
          </>
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

const inviteFormSchema = z
  .object({ name: nameSchema, email: emailSchema.optional(), phone: phoneSchema.optional() })
  .refine((v) => v.email || v.phone, { message: 'Give an email or a mobile number', path: ['email'] });

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(inviteFormSchema);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RoleValue>(emptyRole);
  const [result, setResult] = useState<{ devInviteUrl?: string; signInMethod: string } | null>(null);

  const close = () => {
    setName('');
    setEmail('');
    setPhone('');
    setRole(emptyRole);
    setResult(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? 'Invitation created' : 'Invite user'}
      footer={
        result ? (
          <button className="btn-primary" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button className="btn-secondary" onClick={close}>
              Cancel
            </button>
            <button className="btn-primary" form="invite-form" type="submit" disabled={f.submitting}>
              {f.submitting ? 'Sending…' : 'Send invitation'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          {result.signInMethod === 'email_invitation' ? (
            <p>They’ll get an email with a link to set their password. The link works for 7 days.</p>
          ) : (
            <p>They can sign in now with a code sent to their mobile number. Their account activates on first sign-in.</p>
          )}
          {result.devInviteUrl && (
            <div className="rounded-lg bg-warning-tint p-3 text-warning">
              <p className="font-semibold">Development only</p>
              <p className="mt-1">No email service is connected yet, so here is the link to share yourself:</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-ink">{result.devInviteUrl}</code>
                <button className="btn-secondary btn-sm" type="button" onClick={() => void navigator.clipboard.writeText(result.devInviteUrl!).then(() => toast('success', 'Link copied'))}>
                  <Copy className="size-3.5" aria-hidden />
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <form
          id="invite-form"
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit({ name, email: email || undefined, phone: phone || undefined }, async (data) => {
              const res = await api.post<{ devInviteUrl?: string; signInMethod: string }>('/admin/users', { ...data, role: roleBody(role) });
              await qc.invalidateQueries({ queryKey: ['users'] });
              await qc.invalidateQueries({ queryKey: ['dashboard'] });
              setResult(res);
            });
          }}
        >
          {f.formError && <ErrorNote message={f.formError} />}
          <Field label="Full name" htmlFor="inv-name" error={f.errors.name}>
            <input id="inv-name" autoFocus className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="inv-email" error={f.errors.email} hint="Staff, employers and partners sign in with email.">
            <input id="inv-email" type="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Mobile number" htmlFor="inv-phone" error={f.errors.phone} hint="Learners and trainers sign in with a code sent here.">
            <input id="inv-phone" type="tel" inputMode="numeric" className="field-input" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </Field>
          {can('role.assign') && (
            <fieldset className="rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Role (optional)</legend>
              <RolePicker value={role} onChange={setRole} errors={f.errors} prefix="role." />
            </fieldset>
          )}
        </form>
      )}
    </Modal>
  );
}

export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(path, body ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['user'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
