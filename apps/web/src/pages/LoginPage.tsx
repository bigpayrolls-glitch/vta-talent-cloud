import { loginSchema, otpRequestSchema, otpVerifySchema, type MeDto } from '@vta/shared';
import { ArrowRight, Building2, Eye, EyeOff, GraduationCap, Lock, Mail, Presentation, Smartphone, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ErrorNote, Field, Wordmark } from '../components/ui';
import { api, setCsrfToken } from '../lib/api';
import { homePathFor, useAuth } from '../lib/auth';
import { useForm } from '../lib/useForm';

const WHO = [
  { icon: GraduationCap, title: 'Learners', body: 'Track courses, certificates and job applications' },
  { icon: Building2, title: 'Employers', body: 'Post vacancies and hire trained technicians' },
  { icon: Users, title: 'Training partners', body: 'Manage batches, attendance and assessments' },
  { icon: Presentation, title: 'Trainers', body: 'Deliver training and assess skills' },
];

type Method = 'email' | 'phone';

export function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('email');

  if (!loading && me) return <Navigate to={homePathFor(me)} replace />;

  const afterSignIn = async () => {
    await refresh();
    const fresh = await api.get<MeDto>('/auth/me');
    setCsrfToken(fresh.csrfToken);
    navigate(homePathFor(fresh), { replace: true });
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-tint via-[#fff5f5] to-white lg:flex lg:flex-col">
        <img
          src="/login-hero.webp"
          alt=""
          className="pointer-events-none absolute right-0 bottom-0 hidden h-auto max-h-[88%] w-[42%] object-contain object-right-bottom select-none min-[1360px]:block"
          draggable={false}
        />
        <div className="relative z-10 flex flex-1 flex-col px-12 py-12 xl:px-14">
          <Wordmark tagline large />
          <div className="mt-14">
            <p className="text-[clamp(34px,3.2vw,52px)] font-black leading-[1.12] tracking-[-0.02em] whitespace-nowrap text-ink">
              Build Skills.
              <br />
              <span className="text-[#D7141C]">Connect with Employers.</span>
              <br />
              Grow Your Career.
            </p>
            <p className="mt-4 max-w-[490px] text-lg leading-relaxed text-ink/70">
              One connected platform for automotive training, verified skills and employment opportunities.
            </p>
          </div>
          <ul className="mt-9 max-w-[440px] space-y-4">
            {WHO.map((w) => (
              <li key={w.title} className="flex items-center gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white text-[#D7141C] shadow-[0_4px_14px_rgba(181,18,27,0.10)]">
                  <w.icon className="size-7" strokeWidth={1.75} aria-hidden />
                </span>
                <span>
                  <span className="block font-bold text-ink">{w.title}</span>
                  <span className="block text-[15px] text-ink/70">{w.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-12">
            <span className="block h-[3px] w-10 rounded bg-[#D7141C]" aria-hidden />
            <p className="mt-6 text-[15px] text-ink/75">One platform. Every step from learning to employment.</p>
          </div>
        </div>
      </aside>

      <main className="flex flex-col bg-white px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Wordmark tagline />
        </div>
        <div className="mx-auto my-auto w-full max-w-[520px] py-10">
          <h1 className="text-[32px] font-black tracking-[-0.02em] text-ink sm:text-[38px]">Welcome back</h1>
          <p className="mt-1.5 text-[17px] text-muted">Sign in to continue to your AutoTalent Grid portal.</p>

          <div role="tablist" aria-label="Sign-in method" className="mt-8 grid grid-cols-2 rounded-xl bg-surface p-1">
            {(['email', 'phone'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={method === m}
                onClick={() => setMethod(m)}
                className={`h-11 rounded-lg text-[15px] font-semibold transition-colors ${method === m ? 'bg-white text-[#C8101A] shadow-sm' : 'text-ink/70 hover:text-ink'}`}
              >
                {m === 'email' ? 'Email' : 'Mobile number'}
              </button>
            ))}
          </div>

          <div className="mt-7" role="tabpanel">
            {method === 'email' ? <EmailForm onDone={afterSignIn} /> : <PhoneForm onDone={afterSignIn} />}
          </div>

          <div className="mt-7 flex items-center gap-4 text-sm text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="mt-4 text-center">
            <button type="button" className="font-medium text-[#C8101A] underline underline-offset-2 hover:text-brand-hover" onClick={() => setMethod(method === 'email' ? 'phone' : 'email')}>
              {method === 'email' ? 'Sign in with mobile number' : 'Sign in with Email'}
            </button>
          </p>

          <div className="mt-8 space-y-2 border-t border-line pt-7 text-[15px] text-ink/80">
            <p>
              New to AutoTalent Grid?{' '}
              <Link to="/register" className="font-medium text-[#C8101A] underline underline-offset-2">
                Create an account
              </Link>
              .
            </p>
            <p>
              Employer or training partner?{' '}
              <Link to="/join/employer" className="font-medium text-[#C8101A] underline underline-offset-2">
                Register your organisation
              </Link>
              .
            </p>
            <p className="pt-1 text-sm text-muted">Trainers are added by their training partner or AutoTalent Grid.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** An input with an icon inside its left edge, as in the brand design. */
function IconInput({ icon: Icon, children }: { icon: typeof Mail; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink/55" strokeWidth={1.75} aria-hidden />
      {children}
    </div>
  );
}

function EmailForm({ onDone }: { onDone: () => Promise<void> }) {
  const f = useForm(loginSchema);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form
      noValidate
      className="space-y-5"
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
        <IconInput icon={Mail}>
          <input id="email" type="email" autoComplete="email" inputMode="email" placeholder="Enter your email address" className="field-input h-12 pl-11" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!f.errors.email} />
        </IconInput>
      </Field>
      <Field label="Password" htmlFor="password" error={f.errors.password}>
        <IconInput icon={Lock}>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            className="field-input h-12 pr-12 pl-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!f.errors.password}
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-ink/55 hover:text-ink"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <Eye className="size-5" strokeWidth={1.75} aria-hidden /> : <EyeOff className="size-5" strokeWidth={1.75} aria-hidden />}
          </button>
        </IconInput>
      </Field>
      <p className="-mt-2 text-right text-[15px]">
        <Link to="/forgot-password" className="font-medium text-[#C8101A] underline underline-offset-2">
          Forgot password?
        </Link>
      </p>
      <SubmitButton busy={f.submitting} busyLabel="Signing in…" label="Sign in" />
    </form>
  );
}

function SubmitButton({ busy, busyLabel, label }: { busy: boolean; busyLabel: string; label: string }) {
  return (
    <button type="submit" className="btn-primary h-12 w-full gap-2.5 bg-[#C8101A] text-[17px] hover:bg-brand-hover" disabled={busy}>
      {busy ? busyLabel : label}
      {!busy && <ArrowRight className="size-5" aria-hidden />}
    </button>
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
        <Field label="Mobile number" htmlFor="phone" error={requestForm.errors.phone} hint="We'll send a 6-digit OTP by SMS.">
          <div className="flex">
            <span className="flex items-center gap-2 rounded-l-lg border border-r-0 border-line bg-white px-3.5 text-[15px] text-ink">
              <Smartphone className="size-5 text-ink/55" strokeWidth={1.75} aria-hidden />
              +91
            </span>
            <input id="phone" type="tel" autoComplete="tel-national" inputMode="numeric" className="field-input h-12 rounded-l-none" placeholder="Enter your mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!requestForm.errors.phone} />
          </div>
        </Field>
        <SubmitButton busy={requestForm.submitting} busyLabel="Sending…" label="Send OTP" />
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
      <SubmitButton busy={verifyForm.submitting} busyLabel="Checking…" label="Verify and sign in" />
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
