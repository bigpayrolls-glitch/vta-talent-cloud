import { useQuery } from '@tanstack/react-query';
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '@vta/shared';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useToast } from '../components/toast';
import { ErrorNote, Field, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useForm } from '../lib/useForm';
import { Centered } from './AccessPages';

/** Phase 9: "forgot password" for email sign-ins. Learners and trainers sign in with a phone code instead. */
export function ForgotPasswordPage() {
  const f = useForm(forgotPasswordSchema);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<null | { email: string; stagingLink?: string }>(null);

  if (sent)
    return (
      <Centered>
        <span className="grid size-14 place-items-center rounded-2xl bg-success-tint text-success">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <h1 className="mt-5 text-[28px] font-bold tracking-tight">Check your email</h1>
        <p className="mt-2 text-muted">
          If <span className="font-semibold text-ink">{sent.email}</span> has an account, we&apos;ve sent a link to choose a new password. It works once, for 30 minutes.
        </p>
        {sent.stagingLink && (
          <p role="status" className="mt-6 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">
            Staging (no email yet): <a href={sent.stagingLink} className="font-semibold underline">open your reset link</a>
          </p>
        )}
        <Link to="/login" className="btn-secondary mt-8 h-11 px-6">
          Back to sign in
        </Link>
      </Centered>
    );

  return (
    <Centered>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Back to sign in
      </Link>
      <h1 className="mt-4 text-[28px] font-bold tracking-tight">Forgot your password?</h1>
      <p className="mt-1 text-muted">Enter the email you sign in with. We&apos;ll send a link to choose a new password.</p>
      <form
        noValidate
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit({ email }, async (data) => {
            const res = await api.post<{ ok: true; stagingLink?: string }>('/auth/password/forgot', data);
            setSent({ email: data.email, stagingLink: res.stagingLink });
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Email" htmlFor="email" error={f.errors.email}>
          <input id="email" type="email" inputMode="email" autoComplete="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!f.errors.email} />
        </Field>
        <button type="submit" className="btn-primary h-11 w-full" disabled={f.submitting}>
          {f.submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">Learners and trainers sign in with a code sent to their mobile number, so they have no password to reset.</p>
    </Centered>
  );
}

function NewPasswordFields({
  password,
  confirm,
  setPassword,
  setConfirm,
  error,
  mismatch,
  label = 'New password',
}: {
  password: string;
  confirm: string;
  setPassword: (v: string) => void;
  setConfirm: (v: string) => void;
  error?: string;
  mismatch: string;
  label?: string;
}) {
  return (
    <>
      <Field label={label} htmlFor="new-password" error={error} hint="At least 10 characters. Avoid common passwords.">
        <input id="new-password" type="password" autoComplete="new-password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-password" error={mismatch}>
        <input id="confirm-password" type="password" autoComplete="new-password" className="field-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!mismatch} />
      </Field>
    </>
  );
}

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const f = useForm(resetPasswordSchema);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');
  const check = useQuery({ queryKey: ['reset', token], queryFn: () => api.get<{ email: string }>(`/auth/password/reset/${token}`), retry: false });

  if (check.isLoading) return <Spinner label="Checking your link" />;
  if (check.isError)
    return (
      <Centered>
        <h1 className="text-2xl font-bold">This link can’t be used</h1>
        <p className="mt-2 text-muted">{(check.error as Error).message}</p>
        <Link to="/forgot-password" className="btn-primary mt-6 h-11 px-6">
          Get a new link
        </Link>
      </Centered>
    );

  return (
    <Centered>
      <h1 className="text-[28px] font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-muted">
        For <span className="font-semibold text-ink">{check.data!.email}</span>. You&apos;ll be signed out everywhere and can sign in with the new one.
      </p>
      <form
        noValidate
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirm) return setMismatch('The passwords don’t match');
          setMismatch('');
          void f.submit({ token, password }, async (data) => {
            await api.post('/auth/password/reset', data);
            toast('success', 'Password changed. Sign in with your new password.');
            navigate('/login', { replace: true });
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <NewPasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} error={f.errors.password} mismatch={mismatch} />
        <button type="submit" className="btn-primary h-11 w-full" disabled={f.submitting}>
          {f.submitting ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </Centered>
  );
}

/** Signed in: change the password. Other devices are signed out. */
export function AccountPage() {
  const toast = useToast();
  const f = useForm(changePasswordSchema);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState('');
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Change password" description="You stay signed in here; any other device using your account is signed out." />
      <form
        noValidate
        className="card space-y-4 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirm) return setMismatch('The passwords don’t match');
          setMismatch('');
          void f.submit({ currentPassword: current, newPassword: password }, async (data) => {
            await api.post('/auth/password/change', data);
            setCurrent('');
            setPassword('');
            setConfirm('');
            toast('success', 'Password changed. Other devices were signed out.');
          });
        }}
      >
        {f.formError && !f.errors.currentPassword && <ErrorNote message={f.formError} />}
        <Field label="Current password" htmlFor="current-password" error={f.errors.currentPassword}>
          <input id="current-password" type="password" autoComplete="current-password" className="field-input" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!f.errors.currentPassword} />
        </Field>
        <NewPasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} error={f.errors.newPassword} mismatch={mismatch} />
        <button type="submit" className="btn-primary h-11" disabled={f.submitting}>
          {f.submitting ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
