import { NOTICE_VERSION, otpRequestSchema, registerFields, registerSchema, type MeDto } from '@vta/shared';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { LanguagePicker } from '../components/LanguagePicker';
import { useToast } from '../components/toast';
import { ErrorNote, Field, Wordmark } from '../components/ui';
import { api, setCsrfToken } from '../lib/api';
import { homePathFor, useAuth } from '../lib/auth';
import { t, tn } from '../lib/i18n';
import { useForm } from '../lib/useForm';
import { StagingCode } from './LoginPage';

/** Step one is checked in the browser with the same rules as the server, minus the code. */
const detailsSchema = registerFields.omit({ code: true, signupToken: true });

/** Set by the login page when a new number passed its code check: no second code is needed. */
export interface VerifiedNumber {
  phone: string;
  signupToken: string;
}

/** EE-01: a learner creates their own account with a mobile number, then finishes the profile later. */
export function RegisterPage() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Phase 13: back to enrolling after creating the account. Only paths on this site.
  const raw = params.get('next') ?? '';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const toast = useToast();
  const verified = (useLocation().state as { verified?: VerifiedNumber } | null)?.verified ?? null;
  const details = useForm(detailsSchema);
  const request = useForm(otpRequestSchema);
  const verify = useForm(registerSchema);
  const [v, setV] = useState({ phone: verified?.phone.replace('+91', '') ?? '', name: '', dateOfBirth: '', city: '', acceptPrivacy: false, acceptTerms: false });
  const [sent, setSent] = useState<null | z.output<typeof detailsSchema>>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [stagingCode, setStagingCode] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!loading && me) return <Navigate to={next ?? homePathFor(me)} replace />;

  const sendCode = (data: z.output<typeof detailsSchema>) =>
    request.submit({ phone: data.phone, purpose: 'register' }, async (r) => {
      const res = await api.post<{ stagingCode?: string }>('/auth/otp/request', r);
      setStagingCode(res.stagingCode ?? '');
      setSent(data);
      setCooldown(60);
    });

  const finish = async (data: z.input<typeof registerSchema>) => {
    const res = await api.post<{ existing: boolean }>('/auth/register', data);
    await refresh();
    const fresh = await api.get<MeDto>('/auth/me');
    setCsrfToken(fresh.csrfToken);
    if (res.existing) toast('success', 'This number already had an account, so you are signed in to it.');
    navigate(next ?? (res.existing ? homePathFor(fresh) : '/learn'), { replace: true });
  };

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="min-h-dvh bg-white">
      <header className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 lg:px-6">
        <Link to="/" aria-label={t('AutoTalent Grid home')} className="inline-block w-fit rounded-lg">
          <Wordmark tagline />
        </Link>
        <div className="ml-auto">
          <LanguagePicker compact />
        </div>
      </header>
      <main className="mx-auto w-full max-w-sm px-4 py-8">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t('Sign in instead')}
        </Link>
        <h1 className="mt-4 text-[28px] font-bold tracking-tight">{t('Create your account')}</h1>
        <p className="mt-1 text-muted">
          {verified ? t('This number is new to AutoTalent Grid. Tell us a little about yourself to finish.') : t('For learners and technicians. You can add your skills and experience after this.')}
        </p>
        <p className="mt-2 text-sm text-muted">
          {tn('Are you a trainer? {link}', {
            link: (
              <Link to="/join/trainer" className="font-semibold text-brand underline">
                {t('Sign up as a trainer')}
              </Link>
            ),
          })}
        </p>

        {!sent ? (
          <form
            noValidate
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void details.submit({ ...v, noticeVersion: NOTICE_VERSION }, (data) =>
                verified ? verify.submit({ ...data, phone: verified.phone, signupToken: verified.signupToken }, finish) : sendCode(data),
              );
            }}
          >
            {(details.formError || request.formError || verify.formError) && <ErrorNote message={details.formError || request.formError || verify.formError} />}
            {verified ? (
              <p className="flex items-center gap-2 rounded-lg bg-success-tint px-3.5 py-2.5 text-sm">
                <BadgeCheck className="size-5 text-success" aria-hidden />
                <span>
                  {tn('Mobile number {phone} verified', { phone: <span className="font-semibold">{verified.phone.replace('+91', '+91 ')}</span> })}
                </span>
              </p>
            ) : (
            <Field label={t('Mobile number')} htmlFor="phone" error={details.errors.phone || request.errors.phone} hint={t(`We'll send a 6-digit code to check it is yours.`)}>
              <div className="flex">
                <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-[15px] text-muted">+91</span>
                <input id="phone" type="tel" autoComplete="tel-national" inputMode="numeric" className="field-input rounded-l-none" value={v.phone} onChange={set('phone')} aria-invalid={!!details.errors.phone} />
              </div>
            </Field>
            )}
            <Field label={t('Full name')} htmlFor="name" error={details.errors.name} hint={t('As on your ID card.')}>
              <input id="name" autoComplete="name" className="field-input" value={v.name} onChange={set('name')} aria-invalid={!!details.errors.name} />
            </Field>
            <Field label={t('Date of birth')} htmlFor="dob" error={details.errors.dateOfBirth} hint={t('You must be 18 or older.')}>
              <input id="dob" type="date" autoComplete="bday" className="field-input" value={v.dateOfBirth} onChange={set('dateOfBirth')} aria-invalid={!!details.errors.dateOfBirth} />
            </Field>
            <Field label={t('City or town')} htmlFor="city" error={details.errors.city}>
              <input id="city" autoComplete="address-level2" className="field-input" value={v.city} onChange={set('city')} aria-invalid={!!details.errors.city} />
            </Field>
            <fieldset className="space-y-3 rounded-xl bg-surface/70 px-4 py-3">
              <legend className="sr-only">{t('Agreements')}</legend>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={v.acceptPrivacy} onChange={set('acceptPrivacy')} />
                <span>
                  {tn('I have read the {link}', {
                    link: (
                      <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                        {t('privacy notice')}
                      </a>
                    ),
                  })}
                </span>
              </label>
              {details.errors.acceptPrivacy && <p className="field-error" role="alert">{t(details.errors.acceptPrivacy)}</p>}
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={v.acceptTerms} onChange={set('acceptTerms')} />
                <span>
                  {tn('I agree to the {link}', {
                    link: (
                      <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                        {t('terms of use')}
                      </a>
                    ),
                  })}
                </span>
              </label>
              {details.errors.acceptTerms && <p className="field-error" role="alert">{t(details.errors.acceptTerms)}</p>}
            </fieldset>
            <button type="submit" className="btn-primary h-11 w-full" disabled={details.submitting || request.submitting || verify.submitting}>
              {verified ? (verify.submitting ? t('Creating…') : t('Create account')) : request.submitting ? t('Sending…') : t('Send code')}
            </button>
          </form>
        ) : (
          <form
            noValidate
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify.submit({ ...sent, code }, finish);
            }}
          >
            <p className="text-sm text-muted">
              {tn('A code was sent to {phone}. It expires in 5 minutes.', { phone: <span className="font-semibold text-ink">{sent.phone.replace('+91', '+91 ')}</span> })}
            </p>
            {stagingCode && <StagingCode code={stagingCode} />}
            {(verify.formError || request.formError) && <ErrorNote message={verify.formError || request.formError} />}
            <Field label={t('6-digit code')} htmlFor="code" error={verify.errors.code}>
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
              {verify.submitting ? t('Creating…') : t('Create account')}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="font-medium text-muted hover:text-ink" onClick={() => setSent(null)}>
                {t('Change details')}
              </button>
              <button type="button" className="font-semibold text-brand disabled:text-muted" disabled={cooldown > 0} onClick={() => void sendCode(sent)}>
                {cooldown > 0 ? t('Resend in {s}s', { s: cooldown }) : t('Resend code')}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
