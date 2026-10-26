import { NOTICE_VERSION, orgSignupSchema, PARTNER_SUBTYPE_LABEL, PARTNER_SUBTYPES, SECTOR_LABEL, SECTORS } from '@vta/shared';
import { Building2, HandHeart, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { ErrorNote, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { homePathFor, useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { PublicShell } from './Home';

const COPY = {
  employer: {
    icon: Building2,
    title: 'Register your company',
    lead: 'For dealerships, workshops, fleets and other employers hiring automotive technicians.',
    after: ['Confirm your email and set a password.', 'Add your company details and a registration document (for example GST certificate).', 'VTA checks them. Once verified, you can post jobs and search candidates.'],
    other: { to: '/join/partner', label: 'Registering a training partner or sponsor instead?' },
  },
  partner: {
    icon: HandHeart,
    title: 'Register a training partner',
    lead: 'For OEMs, CSR sponsors, NGOs, colleges and training providers working with VTA.',
    after: ['Confirm your email and set a password.', 'Add your organisation details and a registration document.', 'VTA checks them and links you to the programmes you take part in.'],
    other: { to: '/join/employer', label: 'Hiring technicians instead?' },
  },
} as const;

/** EM-01 / PA-01: an employer or training partner registers from the public site. */
export function JoinPage({ type }: { type: 'employer' | 'partner' }) {
  const { me, loading } = useAuth();
  const f = useForm(orgSignupSchema);
  const blank = { legalName: '', sector: '', partnerSubtype: '', city: '', contactName: '', email: '', phone: '', nickname: '', acceptPrivacy: false, acceptTerms: false };
  const [v, setV] = useState(blank);
  const [sent, setSent] = useState<null | { email: string; stagingLink?: string }>(null);
  const c = COPY[type];

  if (loading) return <Spinner />;
  if (me) return <Navigate to={homePathFor(me)} replace />;

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (sent)
    return (
      <PublicShell>
        <div className="mx-auto w-full max-w-md px-4 py-14 text-center sm:px-6">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-tint text-success">
            <MailCheck className="size-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-[28px] font-bold tracking-tight">Check your email</h1>
          <p className="mt-2 text-muted">
            We&apos;ve sent a link to <span className="font-semibold text-ink">{sent.email}</span> to confirm it and set your password. It works for 7 days.
          </p>
          <p className="mt-3 text-sm text-muted">If this email already has an account, nothing new was created: sign in instead.</p>
          {sent.stagingLink && (
            <p role="status" className="mt-6 rounded-lg bg-warning-tint px-3 py-2 text-left text-sm text-warning">
              Staging (no email yet): <a href={sent.stagingLink} className="font-semibold underline">open your confirmation link</a>
            </p>
          )}
          <Link to="/login" className="btn-secondary mt-8 h-11 px-6">
            Go to sign in
          </Link>
        </div>
      </PublicShell>
    );

  return (
    <PublicShell>
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:py-14">
        <aside>
          <span className="grid size-12 place-items-center rounded-xl bg-brand-tint text-brand">
            <c.icon className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-[30px] leading-tight font-bold tracking-tight">{c.title}</h1>
          <p className="mt-2 text-muted">{c.lead}</p>
          <h2 className="mt-8 text-sm font-semibold tracking-wide text-muted uppercase">What happens next</h2>
          <ol className="mt-3 space-y-3">
            {c.after.map((s, i) => (
              <li key={s} className="flex gap-3 text-[15px]">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm">
            <Link to={c.other.to} className="font-semibold text-brand underline">
              {c.other.label}
            </Link>
          </p>
          <p className="mt-2 text-sm text-muted">
            Learner or technician?{' '}
            <Link to="/register" className="font-semibold text-brand underline">
              Create a learner account
            </Link>
          </p>
        </aside>

        <form
          noValidate
          className="card space-y-4 p-5 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            const body = {
              ...v,
              type,
              sector: type === 'employer' && v.sector ? v.sector : undefined,
              partnerSubtype: type === 'partner' && v.partnerSubtype ? v.partnerSubtype : undefined,
              nickname: v.nickname || undefined,
              noticeVersion: NOTICE_VERSION,
            };
            void f.submit(body, async (data) => {
              const res = await api.post<{ ok: true; stagingLink?: string }>('/public/organisations/register', data);
              setSent({ email: data.email, stagingLink: res.stagingLink });
              window.scrollTo(0, 0);
            });
          }}
        >
          {f.formError && <ErrorNote message={f.formError} />}
          <fieldset className="space-y-4">
            <legend className="text-base font-bold">{type === 'employer' ? 'Company' : 'Organisation'}</legend>
            <Field label="Registered name" htmlFor="legalName" error={f.errors.legalName} hint="As on your registration or GST certificate.">
              <input id="legalName" autoComplete="organization" className="field-input" value={v.legalName} onChange={set('legalName')} aria-invalid={!!f.errors.legalName} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {type === 'employer' ? (
                <Field label="Sector" htmlFor="sector" error={f.errors.sector}>
                  <select id="sector" className="field-input" value={v.sector} onChange={set('sector')} aria-invalid={!!f.errors.sector}>
                    <option value="">Choose…</option>
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>
                        {SECTOR_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Partner type" htmlFor="partnerSubtype" error={f.errors.partnerSubtype}>
                  <select id="partnerSubtype" className="field-input" value={v.partnerSubtype} onChange={set('partnerSubtype')} aria-invalid={!!f.errors.partnerSubtype}>
                    <option value="">Choose…</option>
                    {PARTNER_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {PARTNER_SUBTYPE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="City or town" htmlFor="city" error={f.errors.city}>
                <input id="city" autoComplete="address-level2" className="field-input" value={v.city} onChange={set('city')} aria-invalid={!!f.errors.city} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-t border-line pt-5">
            <legend className="float-left mb-4 w-full text-base font-bold">You</legend>
            <Field label="Your full name" htmlFor="contactName" error={f.errors.contactName}>
              <input id="contactName" autoComplete="name" className="field-input" value={v.contactName} onChange={set('contactName')} aria-invalid={!!f.errors.contactName} />
            </Field>
            <Field label="Work email" htmlFor="email" error={f.errors.email} hint="You sign in with this. We send the confirmation link here.">
              <input id="email" type="email" inputMode="email" autoComplete="email" className="field-input" value={v.email} onChange={set('email')} aria-invalid={!!f.errors.email} />
            </Field>
            <Field label="Mobile number" htmlFor="phone" error={f.errors.phone} hint="So VTA can reach you about the verification.">
              <div className="flex">
                <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-[15px] text-muted">+91</span>
                <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" className="field-input rounded-l-none" value={v.phone} onChange={set('phone')} aria-invalid={!!f.errors.phone} />
              </div>
            </Field>
            {/* Hidden from people (and screen readers); bots tend to fill it in. */}
            <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
              <label htmlFor="nickname">Leave this empty</label>
              <input id="nickname" tabIndex={-1} autoComplete="off" value={v.nickname} onChange={set('nickname')} />
            </div>
          </fieldset>

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
            {f.errors.acceptPrivacy && <p className="field-error" role="alert">{f.errors.acceptPrivacy}</p>}
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={v.acceptTerms} onChange={set('acceptTerms')} />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                  terms of use
                </a>{' '}
                for my organisation
              </span>
            </label>
            {f.errors.acceptTerms && <p className="field-error" role="alert">{f.errors.acceptTerms}</p>}
          </fieldset>

          <button type="submit" className="btn-primary h-11 w-full" disabled={f.submitting}>
            {f.submitting ? 'Sending…' : 'Register and confirm my email'}
          </button>
          <p className="text-center text-sm text-muted">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-brand underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </PublicShell>
  );
}
