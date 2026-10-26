import { loginSchema, otpRequestSchema, otpVerifySchema, type MeDto } from '@vta/shared';
import { Building2, GraduationCap, Settings, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ErrorNote, Field, Wordmark } from '../components/ui';
import { api, setCsrfToken } from '../lib/api';
import { homePathFor, useAuth } from '../lib/auth';
import { useForm } from '../lib/useForm';

const WHO = [
  { icon: GraduationCap, title: 'Learners', body: 'Track courses, certificates and job applications' },
  { icon: Building2, title: 'Employers', body: 'Post jobs and hire trained technicians' },
  { icon: Users, title: 'Training partners and trainers', body: 'Run batches, attendance and assessments' },
  { icon: Settings, title: 'VTA team', body: 'Manage the platform' },
];

export function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState<'email' | 'phone'>('email');

  if (!loading && me) return <Navigate to={homePathFor(me)} replace />;

  const afterSignIn = async () => {
    await refresh();
    const fresh = await api.get<MeDto>('/auth/me');
    setCsrfToken(fresh.csrfToken);
    navigate(homePathFor(fresh), { replace: true });
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-tint px-12 py-12 lg:flex lg:flex-col">
        <Wordmark />
        <div className="mt-auto max-w-md">
          <p className="text-[40px] font-extrabold leading-[1.08] tracking-tight text-ink">
            Learn. Perform.
            <br />
            Earn.
          </p>
          <p className="mt-3 text-lg text-ink/75">Automotive skills for a better tomorrow.</p>
          <ul className="mt-10 space-y-4">
            {WHO.map((w) => (
              <li key={w.title} className="flex items-start gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-sm">
                  <w.icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{w.title}</span>
                  <span className="block text-sm text-ink/70">{w.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-12 text-sm text-ink/60">One sign-in. You land in the portal for your role.</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Wordmark compact />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="text-[28px] font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-muted">Use your email or your registered mobile number.</p>

          <div role="tablist" aria-label="Sign-in method" className="mt-7 grid grid-cols-2 rounded-xl bg-surface p-1">
            {(['email', 'phone'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={method === m}
                onClick={() => setMethod(m)}
                className={`h-10 rounded-lg text-sm font-semibold transition-colors ${method === m ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {m === 'email' ? 'Email' : 'Mobile number'}
              </button>
            ))}
          </div>

          <div className="mt-6" role="tabpanel">
            {method === 'email' ? <EmailForm onDone={afterSignIn} /> : <PhoneForm onDone={afterSignIn} />}
          </div>

          <p className="mt-8 text-sm text-muted">
            Learner or technician, new to VTA?{' '}
            <Link to="/register" className="font-semibold text-brand underline">
              Create an account
            </Link>
.
          </p>
          <p className="mt-2 text-sm text-muted">
            Employer or training partner?{' '}
            <Link to="/join/employer" className="font-semibold text-brand underline">
              Register your organisation
            </Link>
            . Trainers are added by their partner or VTA.
          </p>
        </div>
      </main>
    </div>
  );
}

function EmailForm({ onDone }: { onDone: () => Promise<void> }) {
  const f = useForm(loginSchema);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void f.submit({ email, password }, async (data) => {
          await api.post('/auth/login', data);
          await onDone();
        });
      }}
    >
      {f.formError && <ErrorNote message={f.formError} />}
      <Field label="Email" htmlFor="email" error={f.errors.email}>
        <input id="email" type="email" autoComplete="email" inputMode="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!f.errors.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={f.errors.password}>
        <input id="password" type="password" autoComplete="current-password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!f.errors.password} />
      </Field>
      <button type="submit" className="btn-primary h-11 w-full" disabled={f.submitting}>
        {f.submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function PhoneForm({ onDone }: { onDone: () => Promise<void> }) {
  const requestForm = useForm(otpRequestSchema);
  const verifyForm = useForm(otpVerifySchema);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [stagingCode, setStagingCode] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = () =>
    requestForm.submit({ phone }, async (data) => {
      const res = await api.post<{ stagingCode?: string }>('/auth/otp/request', data);
      setStagingCode(res.stagingCode ?? '');
      setSentTo(data.phone);
      setCooldown(60);
    });

  if (!sentTo) {
    return (
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void requestCode();
        }}
      >
        {requestForm.formError && <ErrorNote message={requestForm.formError} />}
        <Field label="Mobile number" htmlFor="phone" error={requestForm.errors.phone} hint="We'll send a 6-digit code by SMS.">
          <div className="flex">
            <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-[15px] text-muted">+91</span>
            <input id="phone" type="tel" autoComplete="tel-national" inputMode="numeric" className="field-input rounded-l-none" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!requestForm.errors.phone} />
          </div>
        </Field>
        <button type="submit" className="btn-primary h-11 w-full" disabled={requestForm.submitting}>
          {requestForm.submitting ? 'Sending…' : 'Send code'}
        </button>
      </form>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void verifyForm.submit({ phone: sentTo, code }, async (data) => {
          await api.post('/auth/otp/verify', data);
          await onDone();
        });
      }}
    >
      <p className="text-sm text-muted">
        If <span className="font-semibold text-ink">{sentTo.replace('+91', '+91 ')}</span> is registered, a code is on its way. It expires in 5 minutes.
      </p>
      {stagingCode && <StagingCode code={stagingCode} />}
      {(verifyForm.formError || requestForm.formError) && <ErrorNote message={verifyForm.formError || requestForm.formError} />}
      <Field label="6-digit code" htmlFor="code" error={verifyForm.errors.code}>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="field-input text-center text-xl font-semibold tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-invalid={!!verifyForm.errors.code}
        />
      </Field>
      <button type="submit" className="btn-primary h-11 w-full" disabled={verifyForm.submitting}>
        {verifyForm.submitting ? 'Checking…' : 'Verify and sign in'}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="font-medium text-muted hover:text-ink"
          onClick={() => {
            setSentTo(null);
            setCode('');
          }}
        >
          Change number
        </button>
        <button type="button" className="font-semibold text-brand disabled:text-muted" disabled={cooldown > 0} onClick={() => void requestCode()}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

/** Staging only: no SMS provider yet, so the API returns the code and it is shown here. */
export function StagingCode({ code }: { code: string }) {
  return (
    <p role="status" className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">
      Staging (no SMS yet): your code is <span className="font-mono text-base font-bold tracking-widest">{code}</span>
    </p>
  );
}
