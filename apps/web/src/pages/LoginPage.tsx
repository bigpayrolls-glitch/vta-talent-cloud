import { loginSchema, otpRequestSchema, otpVerifySchema, type MeDto } from '@vta/shared';
import { ArrowRight, Building2, Eye, EyeOff, GraduationCap, Lock, Mail, Presentation, Smartphone, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LanguagePicker } from '../components/LanguagePicker';
import { ErrorNote, Field, Wordmark } from '../components/ui';
import { api, setCsrfToken } from '../lib/api';
import { homePathFor, useAuth } from '../lib/auth';
import { t, tn } from '../lib/i18n';
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
  const [params] = useSearchParams();
  // Phase 13: where to go after signing in, for example back to enrolling in a batch. Only paths on this site.
  const raw = params.get('next') ?? '';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const enrolling = !!next?.startsWith('/enrol/');
  const [method, setMethod] = useState<Method>(enrolling ? 'phone' : 'email');

  if (!loading && me) return <Navigate to={next ?? homePathFor(me)} replace />;

  const afterSignIn = async () => {
    await refresh();
    const fresh = await api.get<MeDto>('/auth/me');
    setCsrfToken(fresh.csrfToken);
    navigate(next ?? homePathFor(fresh), { replace: true });
  };

  return (
    <div className="grid min-h-[calc(100dvh-var(--banner-h,0px))] lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-tint via-[#fff5f5] to-white lg:flex lg:flex-col">
        <img
          src="/login-hero.webp"
          alt=""
          className="pointer-events-none absolute right-0 bottom-0 hidden h-auto max-h-[88%] w-[42%] object-contain object-right-bottom select-none min-[1360px]:block"
          draggable={false}
        />
        <div className="relative z-10 flex flex-1 flex-col px-12 py-[clamp(20px,5vh,48px)] xl:px-14">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to="/" aria-label={t('AutoTalent Grid home')} className="inline-block w-fit rounded-lg">
              <Wordmark tagline large={false} />
            </Link>
            <LanguagePicker />
          </div>
          <div className="mt-[clamp(16px,5vh,56px)]">
            <p className="text-[clamp(28px,min(3.2vw,5.4vh),52px)] font-black leading-[1.12] tracking-[-0.02em] whitespace-nowrap text-ink">
              {t('Build Skills.')}
              <br />
              <span className="text-[#D7141C]">{t('Connect with Employers.')}</span>
              <br />
              {t('Grow Your Career.')}
            </p>
            <p className="mt-3 max-w-[490px] text-[clamp(15px,2.2vh,18px)] leading-relaxed text-ink/70">
              {t('One connected platform for automotive training, verified skills and employment opportunities.')}
            </p>
          </div>
          <ul className="mt-[clamp(14px,4vh,36px)] max-w-[440px] space-y-[clamp(8px,1.8vh,16px)]">
            {WHO.map((w) => (
              <li key={w.title} className="flex items-center gap-4">
                <span className="grid size-[clamp(40px,6.4vh,56px)] shrink-0 place-items-center rounded-2xl bg-white text-[#D7141C] shadow-[0_4px_14px_rgba(181,18,27,0.10)]">
                  <w.icon className="size-7" strokeWidth={1.75} aria-hidden />
                </span>
                <span>
                  <span className="block font-bold text-ink">{t(w.title)}</span>
                  <span className="block text-[15px] text-ink/70">{t(w.body)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-[clamp(12px,4vh,48px)] [@media(max-height:820px)]:hidden">
            <span className="block h-[3px] w-10 rounded bg-[#D7141C]" aria-hidden />
            <p className="mt-6 text-[15px] text-ink/75">{t('One platform. Every step from learning to employment.')}</p>
          </div>
        </div>
      </aside>

      <main className="flex flex-col bg-white px-5 py-[clamp(12px,3vh,24px)] sm:px-10">
        <div className="flex flex-wrap items-center gap-3 lg:hidden">
          <Link to="/" aria-label={t('AutoTalent Grid home')} className="inline-block w-fit rounded-lg">
            <Wordmark tagline />
          </Link>
          <div className="ml-auto">
            <LanguagePicker compact />
          </div>
        </div>
        <div className="mx-auto my-auto w-full max-w-[520px] py-[clamp(12px,4vh,40px)]">
          <h1 className="text-[clamp(28px,4.6vh,38px)] font-black tracking-[-0.02em] text-ink">{enrolling ? t('Sign in to enrol') : t('Welcome back')}</h1>
          <p className="mt-1.5 text-[17px] text-muted">{enrolling ? t('Sign in with your mobile number, or create a learner account, to continue your enrolment.') : t('Sign in to continue to your AutoTalent Grid portal.')}</p>

          <div role="tablist" aria-label={t('Sign-in method')} className="mt-[clamp(16px,3.5vh,32px)] grid grid-cols-2 rounded-xl bg-surface p-1">
            {(['email', 'phone'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={method === m}
                onClick={() => setMethod(m)}
                className={`flex h-[52px] flex-col items-center justify-center rounded-lg leading-tight transition-colors ${method === m ? 'bg-white text-[#C8101A] shadow-sm' : 'text-ink/70 hover:text-ink'}`}
              >
                <span className="text-[15px] font-semibold">{m === 'email' ? t('Email') : t('Mobile number')}</span>
                <span className="text-xs text-ink/70">{m === 'email' ? t('Employers, partners and staff') : t('Learners and trainers')}</span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-sm text-ink/70 [@media(max-height:820px)]:hidden">
            {method === 'email'
              ? t('Employers, training partners and AutoTalent Grid staff sign in with their email and password.')
              : t('Learners and trainers sign in with their mobile number. We send a one-time code (OTP).')}
          </p>

          <div className="mt-4 [@media(max-height:820px)]:mt-3" role="tabpanel">
            {method === 'email' ? <EmailForm onDone={afterSignIn} /> : <PhoneForm onDone={afterSignIn} next={next} />}
          </div>

          <div className="mt-[clamp(16px,3.5vh,32px)] space-y-1.5 border-t border-line pt-[clamp(12px,3vh,28px)] text-[15px] text-ink/80">
            <p>
              {tn('New to AutoTalent Grid? {create} or {trainer}.', {
                create: (
                  <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="font-medium text-[#C8101A] underline underline-offset-2">
                    {t('Create an account')}
                  </Link>
                ),
                trainer: (
                  <Link to="/join/trainer" className="font-medium text-[#C8101A] underline underline-offset-2">
                    {t('sign up as a trainer')}
                  </Link>
                ),
              })}
            </p>
            <p>
              {tn('Employer or training partner? {register}.', {
                register: (
                  <Link to="/join/employer" className="font-medium text-[#C8101A] underline underline-offset-2">
                    {t('Register your organisation')}
                  </Link>
                ),
              })}
            </p>

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
      className="space-y-[clamp(12px,2.2vh,20px)]"
      onSubmit={(e) => {
        e.preventDefault();
        void f.submit({ email, password }, async (data) => {
          await api.post('/auth/login', data);
          await onDone();
        });
      }}
    >
      {f.formError && <ErrorNote message={f.formError} />}
      <Field label={t('Email')} htmlFor="email" error={f.errors.email}>
        <IconInput icon={Mail}>
          <input id="email" type="email" autoComplete="email" inputMode="email" placeholder={t('Enter your email address')} className="field-input h-12 pl-11" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!f.errors.email} />
        </IconInput>
      </Field>
      <Field label={t('Password')} htmlFor="password" error={f.errors.password}>
        <IconInput icon={Lock}>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('Enter your password')}
            className="field-input h-12 pr-12 pl-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!f.errors.password}
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-ink/55 hover:text-ink"
            aria-label={showPassword ? t('Hide password') : t('Show password')}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <Eye className="size-5" strokeWidth={1.75} aria-hidden /> : <EyeOff className="size-5" strokeWidth={1.75} aria-hidden />}
          </button>
        </IconInput>
      </Field>
      <p className="-mt-2 text-right text-[15px]">
        <Link to="/forgot-password" className="font-medium text-[#C8101A] underline underline-offset-2">
          {t('Forgot password?')}
        </Link>
      </p>
      <SubmitButton busy={f.submitting} busyLabel={t('Signing in…')} label={t('Sign in')} />
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

function PhoneForm({ onDone, next }: { onDone: () => Promise<void>; next: string | null }) {
  const navigate = useNavigate();
  const requestForm = useForm(otpRequestSchema);
  const verifyForm = useForm(otpVerifySchema);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [stagingCode, setStagingCode] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
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
        <Field label={t('Mobile number')} htmlFor="phone" error={requestForm.errors.phone} hint={t(`We'll send a 6-digit OTP by SMS. New here? You can create your account right after.`)}>
          <div className="flex">
            <span className="flex items-center gap-2 rounded-l-lg border border-r-0 border-line bg-white px-3.5 text-[15px] text-ink">
              <Smartphone className="size-5 text-ink/55" strokeWidth={1.75} aria-hidden />
              +91
            </span>
            <input id="phone" type="tel" autoComplete="tel-national" inputMode="numeric" className="field-input h-12 rounded-l-none" placeholder={t('Enter your mobile number')} value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!requestForm.errors.phone} />
          </div>
        </Field>
        <SubmitButton busy={requestForm.submitting} busyLabel={t('Sending…')} label={t('Send OTP')} />
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
          const r = await api.post<{ needsSignup: boolean; signupToken?: string }>('/auth/otp/verify', data);
          // A new number: go on to create the learner account, with the number already checked.
          if (r.needsSignup && r.signupToken) {
            navigate(`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`, { state: { verified: { phone: data.phone, signupToken: r.signupToken } } });
            return;
          }
          await onDone();
        });
      }}
    >
      <p className="text-sm text-muted">
        {tn('A code has been sent to {phone}. It expires in 5 minutes.', { phone: <span className="font-semibold text-ink">{sentTo.replace('+91', '+91 ')}</span> })}
      </p>
      {stagingCode && <StagingCode code={stagingCode} />}
      {(verifyForm.formError || requestForm.formError) && <ErrorNote message={verifyForm.formError || requestForm.formError} />}
      <Field label={t('6-digit code')} htmlFor="code" error={verifyForm.errors.code}>
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
      <SubmitButton busy={verifyForm.submitting} busyLabel={t('Checking…')} label={t('Verify and continue')} />
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="font-medium text-muted hover:text-ink"
          onClick={() => {
            setSentTo(null);
            setCode('');
          }}
        >
          {t('Change number')}
        </button>
        <button type="button" className="font-semibold text-brand disabled:text-muted" disabled={cooldown > 0} onClick={() => void requestCode()}>
          {cooldown > 0 ? t('Resend in {s}s', { s: cooldown }) : t('Resend code')}
        </button>
      </div>
    </form>
  );
}

/** Staging only: no SMS provider yet, so the API returns the code and it is shown here. */
export function StagingCode({ code }: { code: string }) {
  return (
    <p role="status" className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">
      {tn('Staging (no SMS yet): your code is {code}', { code: <span className="font-mono text-base font-bold tracking-widest">{code}</span> })}
    </p>
  );
}
