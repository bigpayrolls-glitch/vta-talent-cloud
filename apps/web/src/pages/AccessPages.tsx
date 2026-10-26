import { PORTAL_LABEL, acceptInvitationSchema, type Portal } from '@vta/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { ErrorNote, Field, Spinner, Wordmark } from '../components/ui';
import { api } from '../lib/api';
import { homePathFor, PORTAL_PATH, useAuth } from '../lib/auth';
import { useForm } from '../lib/useForm';

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-5 py-8">
      <Link to="/" aria-label="AutoTalent Grid home" className="inline-block w-fit rounded-lg">
            <Wordmark tagline />
          </Link>
      <main className="mx-auto my-auto w-full max-w-md py-10">{children}</main>
    </div>
  );
}

/**
 * Route guard. Shows the portal only to users who hold a role for it.
 * This is a convenience: the API refuses every call from users without the permission.
 */
export function RequirePortal({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me.portals.includes(portal)) return <AccessDenied portal={portal} />;
  return <>{children}</>;
}

export function AccessDenied({ portal }: { portal: Portal }) {
  const { me } = useAuth();
  return (
    <Centered>
      <span className="grid size-12 place-items-center rounded-xl bg-brand-tint text-brand">
        <ShieldAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-bold">Access denied</h1>
      <p className="mt-2 text-muted">
        Your account doesn’t have access to the {PORTAL_LABEL[portal]}. If you think it should, ask an AutoTalent Grid administrator to check your role.
      </p>
      {me && (
        <Link to={homePathFor(me)} className="btn-primary mt-6">
          Go to my portal
        </Link>
      )}
    </Centered>
  );
}

export function ChoosePortal() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <Centered>
      <h1 className="text-2xl font-bold">Choose a portal</h1>
      <p className="mt-2 text-muted">Your account has more than one role. You can switch any time from your name at the top right.</p>
      <ul className="mt-6 space-y-3">
        {me.portals.map((p) => (
          <li key={p}>
            <Link to={PORTAL_PATH[p]} className="card flex items-center justify-between px-5 py-4 font-semibold hover:border-brand">
              {PORTAL_LABEL[p]}
              <ArrowRight className="size-5 text-brand" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Centered>
  );
}

export function NoAccess() {
  const { signOut } = useAuth();
  return (
    <Centered>
      <h1 className="text-2xl font-bold">Your account has no role yet</h1>
      <p className="mt-2 text-muted">You’re signed in, but no portal has been assigned to you. An AutoTalent Grid administrator needs to give your account a role.</p>
      <button className="btn-secondary mt-6" onClick={signOut}>
        Sign out
      </button>
    </Centered>
  );
}

export function NotFound() {
  return (
    <Centered>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">The page you opened doesn’t exist or has moved.</p>
      <Link to="/" className="btn-primary mt-6">
        Go home
      </Link>
    </Centered>
  );
}

export function HomeRedirect() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  return <Navigate to={me ? homePathFor(me) : '/login'} replace />;
}

export function AcceptInvitation() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const f = useForm(acceptInvitationSchema);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ name: string; email: string; expiresAt: string; selfRegistered: boolean; organisationName: string | null; organisationType: string | null }>(`/auth/invitations/${token}`),
    retry: false,
  });

  if (invite.isLoading) return <Spinner label="Checking your invitation" />;
  if (invite.isError)
    return (
      <Centered>
        <h1 className="text-2xl font-bold">This link can’t be used</h1>
        <p className="mt-2 text-muted">{(invite.error as Error).message}</p>
        <Link to="/login" className="btn-secondary mt-6">
          Go to sign in
        </Link>
      </Centered>
    );

  const self = invite.data!.selfRegistered;
  return (
    <Centered>
      <h1 className="text-[28px] font-bold tracking-tight">{self ? 'Confirm your email' : `Welcome, ${invite.data!.name.split(' ')[0]}`}</h1>
      {self ? (
        <p className="mt-2 text-muted">
          Set a password for <span className="font-semibold text-ink">{invite.data!.email}</span> to finish registering{' '}
          <span className="font-semibold text-ink">{invite.data!.organisationName}</span>. Next you add your details and a registration document so AutoTalent Grid can verify you.
        </p>
      ) : (
        <p className="mt-2 text-muted">
          Set a password to finish creating your account for <span className="font-semibold text-ink">{invite.data!.email}</span>.
        </p>
      )}
      <form
        noValidate
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirm) {
            setMismatch('The passwords don’t match');
            return;
          }
          setMismatch('');
          void f.submit({ password }, async (data) => {
            await api.post(`/auth/invitations/${token}/accept`, data);
            await refresh();
            // A self-registered organisation goes straight to its profile, where it adds documents and sends it to VTA.
            const next = !invite.data!.selfRegistered ? '/' : invite.data!.organisationType === 'partner' ? '/partner/organisation' : '/employer/company';
            navigate(next, { replace: true });
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="New password" htmlFor="password" error={f.errors.password} hint="At least 10 characters. Avoid common passwords.">
          <input id="password" type="password" autoComplete="new-password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={mismatch}>
          <input id="confirm" type="password" autoComplete="new-password" className="field-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary h-11 w-full" disabled={f.submitting}>
          {f.submitting ? 'Saving…' : self ? 'Confirm and sign in' : 'Create account and sign in'}
        </button>
      </form>
    </Centered>
  );
}
