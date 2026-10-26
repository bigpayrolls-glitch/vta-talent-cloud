import { ArrowRight, BadgeCheck, Briefcase, Building2, ClipboardCheck, GraduationCap, HandHeart, QrCode, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Spinner, Wordmark } from '../../components/ui';
import { homePathFor, useAuth } from '../../lib/auth';

/**
 * Phase 8: the public front door. It describes only what this platform does today, with no figures or
 * claims (those need evidence from VTA first). VTA's existing website stays the place for the wider story.
 * Signed-in people go straight to their portal.
 */
const JOURNEY = [
  { icon: GraduationCap, title: 'Train', body: 'Join a batch at a VTA or partner centre.' },
  { icon: ClipboardCheck, title: 'Get assessed', body: 'Your trainer assesses each skill; VTA reviews the result.' },
  { icon: BadgeCheck, title: 'Earn a record', body: 'A completion record anyone can check with its QR code.' },
  { icon: Briefcase, title: 'Find work', body: 'Apply to jobs from employers VTA has verified.' },
];

const AUDIENCES = [
  {
    icon: GraduationCap,
    title: 'Learners and technicians',
    points: ['Your courses, attendance and results in one place', 'Certificates you can share', 'Jobs from verified employers; you choose who sees your profile'],
    cta: 'Create an account',
    to: '/register',
    note: 'With your mobile number.',
  },
  {
    icon: Building2,
    title: 'Employers',
    points: ['Post jobs, reviewed by VTA before they go live', 'Find trained technicians who have opted in', 'Shortlist, interview and record who you hired'],
    cta: 'Register your company',
    to: '/join/employer',
    note: 'VTA verifies your company first.',
  },
  {
    icon: HandHeart,
    title: 'Training partners and sponsors',
    points: ['Run batches, attendance and assessments', 'Programme dashboards with clear definitions', 'Reports to download for your sponsors'],
    cta: 'Register your organisation',
    to: '/join/partner',
    note: 'For OEMs, CSR sponsors, NGOs, colleges and training providers.',
  },
];

export function PublicHomePage() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (me) return <Navigate to={homePathFor(me)} replace />;

  return (
    <PublicShell>
      <section className="border-b border-line bg-gradient-to-b from-brand-tint/70 to-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-20">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">Automotive skills for a better tomorrow</p>
            <h1 className="mt-3 text-[44px] leading-[1.02] font-extrabold tracking-tight sm:text-[56px]">
              Learn. Perform.
              <br />
              Earn.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink/75">
              VTA Talent Cloud brings training, verified skills and hiring for automotive technicians together, for learners, employers and the partners who train them.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="btn-primary h-12 px-6 text-base">
                Create a learner account
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link to="/login" className="btn-secondary h-12 px-6 text-base">
                Sign in
              </Link>
            </div>
          </div>

          <ol className="relative grid gap-3" aria-label="How it works">
            {JOURNEY.map((s, i) => (
              <li key={s.title} className="card flex items-start gap-4 p-4 sm:p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-muted">Step {i + 1}</span>
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-sm text-muted">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20" aria-labelledby="who">
        <h2 id="who" className="text-[28px] font-bold tracking-tight sm:text-[32px]">
          One platform, a portal for each of you
        </h2>
        <p className="mt-2 max-w-2xl text-muted">Sign in once and you land in the portal for your role. Each one shows only what that role is allowed to see.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <article key={a.title} className="card flex flex-col p-6">
              <span className="grid size-12 place-items-center rounded-xl bg-brand-tint text-brand">
                <a.icon className="size-6" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-bold">{a.title}</h3>
              <ul className="mt-3 flex-1 space-y-2 text-[15px]">
                {a.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <Link to={a.to} className="btn-primary mt-6 h-11 w-full">
                {a.cta}
              </Link>
              <p className="mt-2 text-center text-xs text-muted">{a.note}</p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">Trainers are added by their training partner or by VTA, and sign in with their mobile number.</p>
      </section>

      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-16">
          <div className="flex gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-ink shadow-sm">
              <ShieldCheck className="size-6" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-bold">Checked by VTA</h2>
              <p className="mt-2 text-muted">
                VTA verifies learner profiles, employers and training partners before they take part in hiring or programmes, and reviews every job before it is published. Employers see a learner&apos;s profile only if the learner allows it.
              </p>
            </div>
          </div>
          <CertificateCheck />
        </div>
      </section>
    </PublicShell>
  );
}

/** Takes a certificate code, or a pasted check-page link, and opens the public check page. */
function CertificateCheck() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      id="check"
      noValidate
      className="card p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim().toLowerCase().split('/').filter(Boolean).pop() ?? '';
        if (!/^[a-z0-9]{32}$/.test(code)) {
          setError('Enter the code printed under the QR code (32 letters and numbers), or paste the check link.');
          return;
        }
        navigate(`/verify/${code}`);
      }}
    >
      <div className="flex items-center gap-2">
        <QrCode className="size-5 text-brand" aria-hidden />
        <h2 className="text-xl font-bold">Check a certificate</h2>
      </div>
      <p className="mt-1 text-sm text-muted">Scan the QR code on the certificate, or enter its code here.</p>
      <label htmlFor="cert-code" className="sr-only">
        Certificate code
      </label>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          id="cert-code"
          className="field-input font-mono"
          placeholder="Certificate code or link"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          aria-invalid={!!error}
          aria-describedby={error ? 'cert-error' : undefined}
        />
        <button type="submit" className="btn-secondary h-11 shrink-0 px-5">
          Check
        </button>
      </div>
      {error && (
        <p id="cert-error" className="field-error mt-2" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="VTA Talent Cloud home">
            <Wordmark compact />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="/#check" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">
              Check a certificate
            </a>
            <Link to="/login" className="btn-secondary h-10 px-4">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-ink text-white/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <span className="text-2xl font-black tracking-tight text-white italic">VTA</span>
            <span className="ml-2 text-sm font-semibold tracking-wide text-white">TALENT CLOUD</span>
            <p className="mt-2 max-w-xs text-sm text-white/60">Learn. Perform. Earn.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
            <Link to="/register" className="hover:text-white">Create a learner account</Link>
            <Link to="/privacy" className="hover:text-white">Privacy notice</Link>
            <Link to="/join/employer" className="hover:text-white">Register your company</Link>
            <Link to="/terms" className="hover:text-white">Terms of use</Link>
            <Link to="/join/partner" className="hover:text-white">Register a training partner</Link>
            <Link to="/login" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
