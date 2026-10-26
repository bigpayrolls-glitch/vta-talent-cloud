import { NOTICE_VERSION, otpRequestSchema, registerSchema, type MeDto } from '@vta/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { useToast } from '../components/toast';
import { ErrorNote, Field, Wordmark } from '../components/ui';
import { api, setCsrfToken } from '../lib/api';
import { homePathFor, useAuth } from '../lib/auth';
import { useForm } from '../lib/useForm';
import { StagingCode } from './LoginPage';

/** Step one is checked in the browser with the same rules as the server, minus the code. */
const detailsSchema = registerSchema.omit({ code: true });

/** EE-01: a learner creates their own account with a mobile number, then finishes the profile later. */
export function RegisterPage() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const details = useForm(detailsSchema);
  const request = useForm(otpRequestSchema);
  const verify = useForm(registerSchema);
  const [v, setV] = useState({ phone: '', name: '', dateOfBirth: '', city: '', acceptPrivacy: false, acceptTerms: false });
  const [sent, setSent] = useState<null | z.output<typeof detailsSchema>>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [stagingCode, setStagingCode] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!loading && me) return <Navigate to={homePathFor(me)} replace />;

  const sendCode = (data: z.output<typeof detailsSchema>) =>
    request.submit({ phone: data.phone, purpose: 'register' }, async (r) => {
      const res = await api.post<{ stagingCode?: string }>('/auth/otp/request', r);
      setStagingCode(res.stagingCode ?? '');
      setSent(data);
      setCooldown(60);
    });

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="min-h-dvh bg-white">
      <header className="flex h-16 items-center border-b border-line px-4 lg:px-6">
        <Link to="/login" aria-label="AutoTalent Grid sign in">
          <Wordmark tagline />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-sm px-4 py-8">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          Sign in instead
        </Link>
        <h1 className="mt-4 text-[28px] font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-muted">For learners and technicians. You can add your skills and experience after this.</p>

        {!sent ? (
          <form
            noValidate
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void details.submit({ ...v, noticeVersion: NOTICE_VERSION }, sendCode);
            }}
          >
            {(details.formError || request.formError) && <ErrorNote message={details.formError || request.formError} />}
            <Field label="Mobile number" htmlFor="phone" error={details.errors.phone || request.errors.phone} hint="We'll send a 6-digit code to check it is yours.">
              <div className="flex">
                <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-[15px] text-muted">+91</span>
                <input id="phone" type="tel" autoComplete="tel-national" inputMode="numeric" className="field-input rounded-l-none" value={v.phone} onChange={set('phone')} aria-invalid={!!details.errors.phone} />
              </div>
            </Field>
            <Field label="Full name" htmlFor="name" error={details.errors.name} hint="As on your ID card.">
              <input id="name" autoComplete="name" className="field-input" value={v.name} onChange={set('name')} aria-invalid={!!details.errors.name} />
            </Field>
            <Field label="Date of birth" htmlFor="dob" error={details.errors.dateOfBirth} hint="You must be 18 or older.">
              <input id="dob" type="date" autoComplete="bday" className="field-input" value={v.dateOfBirth} onChange={set('dateOfBirth')} aria-invalid={!!details.errors.dateOfBirth} />
            </Field>
            <Field label="City or town" htmlFor="city" error={details.errors.city}>
              <input id="city" autoComplete="address-level2" className="field-input" value={v.city} onChange={set('city')} aria-invalid={!!details.errors.city} />
            </Field>
            <fieldset className="space-y-3 rounded-xl bg-surface/70 px-4 py-3">
              <legend className="sr-only">Agreements</legend>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={v.acceptPrivacy} onChange={set('acceptPrivacy')} />
                <span>
                  I have read the{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                    privacy notice
                  </a>
                </span>
              </label>
              {details.errors.acceptPrivacy && <p className="field-error" role="alert">{details.errors.acceptPrivacy}</p>}
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={v.acceptTerms} onChange={set('acceptTerms')} />
                <span>
                  I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                    terms of use
                  </a>
                </span>
              </label>
              {details.errors.acceptTerms && <p className="field-error" role="alert">{details.errors.acceptTerms}</p>}
            </fieldset>
            <button type="submit" className="btn-primary h-11 w-full" disabled={details.submitting || request.submitting}>
              {request.submitting ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form
            noValidate
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify.submit({ ...sent, code }, async (data) => {
                const res = await api.post<{ existing: boolean }>('/auth/register', data);
                await refresh();
                const fresh = await api.get<MeDto>('/auth/me');
                setCsrfToken(fresh.csrfToken);
                if (res.existing) toast('success', 'This number already had an account, so you are signed in to it.');
                navigate(res.existing ? homePathFor(fresh) : '/learn', { replace: true });
              });
            }}
          >
            <p className="text-sm text-muted">
              A code was sent to <span className="font-semibold text-ink">{sent.phone.replace('+91', '+91 ')}</span>. It expires in 5 minutes.
            </p>
            {stagingCode && <StagingCode code={stagingCode} />}
            {(verify.formError || request.formError) && <ErrorNote message={verify.formError || request.formError} />}
            <Field label="6-digit code" htmlFor="code" error={verify.errors.code}>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="field-input text-center text-xl font-semibold tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-invalid={!!verify.errors.code}
              />
            </Field>
            <button type="submit" className="btn-primary h-11 w-full" disabled={verify.submitting}>
              {verify.submitting ? 'Creating…' : 'Create account'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="font-medium text-muted hover:text-ink" onClick={() => setSent(null)}>
                Change details
              </button>
              <button type="button" className="font-semibold text-brand disabled:text-muted" disabled={cooldown > 0} onClick={() => void sendCode(sent)}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
