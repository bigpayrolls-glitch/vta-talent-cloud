import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  ClipboardCheck,
  GraduationCap,
  Lock,
  Presentation,
  QrCode,
  ScanLine,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Modal, Spinner, Wordmark } from '../../components/ui';
import { homePathFor, useAuth } from '../../lib/auth';

/**
 * The public front door, laid out to the brand design of 26 Oct 2026: on a laptop or desktop it fits one screen.
 * It describes only what the platform does today: no figures, video or claims that need evidence first.
 * Signed-in people go straight to their portal.
 */
const ROLES = [
  { icon: GraduationCap, title: 'Learners', body: 'Learn skills and apply for jobs.', to: '/register', img: '/role-learner.webp', tint: 'bg-[#FDECEE]', cta: 'Learners: create an account' },
  { icon: Building2, title: 'Employers', body: 'Find skilled technicians.', to: '/join/employer', img: '/role-employer.webp', tint: 'bg-[#EAF1FB]', cta: 'Employers: register your company' },
  { icon: Users, title: 'Training partners', body: 'Run training and assessments.', to: '/join/partner', img: '/role-partner.webp', tint: 'bg-[#FDF3E4]', cta: 'Training partners: register your organisation' },
  { icon: Presentation, title: 'Trainers', body: 'Teach and assess skills.', to: '/login', img: '/role-trainer.webp', tint: 'bg-[#E8F4EE]', cta: 'Trainers: sign in' },
];

const STEPS = [
  { icon: GraduationCap, title: 'Learn', body: 'Join a course.' },
  { icon: ClipboardCheck, title: 'Get assessed', body: 'Show your skills.' },
  { icon: BadgeCheck, title: 'Build your record', body: 'Keep it in one place.' },
  { icon: Briefcase, title: 'Apply for jobs', body: 'Connect with employers.' },
];

const TRUST = [
  { icon: ShieldCheck, title: 'Verified employers', body: 'Checked before they hire' },
  { icon: ClipboardCheck, title: 'Reviewed jobs', body: 'Checked before going live' },
  { icon: QrCode, title: 'Checkable certificates', body: 'Check one by its QR code' },
  { icon: Lock, title: 'Your choice', body: 'You decide who sees your profile' },
];

export function PublicHomePage() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (me) return <Navigate to={homePathFor(me)} replace />;

  return (
    <PublicShell fit>
      <div className="flex flex-col lg:h-full">
        <section className="relative overflow-hidden bg-gradient-to-r from-brand-tint via-[#fdf1f1] to-white lg:min-h-0 lg:flex-1">
          <img src="/home-hero.webp" alt="" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[60%] object-cover object-top select-none lg:block" draggable={false} />
          <div className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 lg:py-6">
            <p className="text-[13px] font-bold tracking-wide text-[#D7141C] uppercase lg:[@media(max-height:820px)]:hidden">Automotive skills. Real opportunities.</p>
            <h1 className="mt-3 text-[clamp(34px,3.6vh+1.05vw,60px)] leading-[1.05] font-black tracking-[-0.025em] text-ink">
              Learn. <span className="text-[#D7141C]">Get Assessed.</span>
              <br />
              Move to a Job.
            </h1>
            <p className="mt-3 max-w-[520px] text-[clamp(16px,1.6vh+0.5vw,22px)] leading-snug text-ink/70">
              A simple platform for learners, training partners and automotive employers.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row lg:[@media(max-height:820px)]:mt-4">
              <Link to="/register" className="btn-primary h-12 bg-[#C8101A] px-7 text-base hover:bg-brand-hover">
                Create a learner account
                <ArrowRight className="size-5" aria-hidden />
              </Link>
              <Link to="/join/employer" className="btn h-12 border border-[#D7141C] bg-white px-7 text-base text-ink hover:bg-brand-tint">
                Register your company
              </Link>
            </div>
          </div>
          <img src="/home-hero.webp" alt="" className="h-52 w-full object-cover object-[70%_25%] sm:h-72 lg:hidden" />
        </section>

        <section aria-label="Who it is for" className="mx-auto grid w-full max-w-[1440px] shrink-0 grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-12">
          {ROLES.map((r) => (
            <Link key={r.title} to={r.to} aria-label={r.cta} className={`group relative flex h-[clamp(118px,15vh,158px)] overflow-hidden rounded-2xl ${r.tint} p-4 ring-1 ring-black/5 transition hover:shadow-md`}>
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-[#D7141C] shadow-sm">
                <r.icon className="size-6" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="ml-3 flex max-w-[56%] flex-col pt-0.5">
                <span className="block text-lg font-bold text-ink">{r.title}</span>
                <span className="mt-1 block text-[14px] leading-snug text-ink/70">{r.body}</span>
                <span className="mt-auto grid size-8 shrink-0 place-items-center self-start rounded-full bg-[#D7141C] text-white shadow transition group-hover:translate-x-0.5" aria-hidden>
                  <ArrowRight className="size-4" />
                </span>
              </span>
              <img src={r.img} alt="" className="absolute right-0 bottom-0 h-[96%] w-auto select-none" draggable={false} />
            </Link>
          ))}
        </section>

        <section aria-labelledby="how" className="mx-auto w-full max-w-[1440px] shrink-0 px-5 py-[clamp(12px,2.2vh,24px)] sm:px-8 lg:px-12">
          <h2 id="how" className="text-[26px] font-bold tracking-tight text-ink">
            How it works
          </h2>
          <ol className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-center gap-4">
                <span className="grid size-[clamp(56px,8vh,80px)] shrink-0 place-items-center rounded-full bg-brand-tint text-[#D7141C]">
                  <s.icon className="size-8" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold text-ink">
                    {i + 1}. {s.title}
                  </span>
                  <span className="block text-[15px] text-ink/70">{s.body}</span>
                </span>
                {i < STEPS.length - 1 && <ArrowRight className="hidden size-6 shrink-0 text-[#D7141C] lg:block" aria-hidden />}
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Checked by AutoTalent Grid" className="shrink-0 bg-surface">
          <ul className="mx-auto grid max-w-[1440px] gap-4 px-5 py-4 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:divide-x lg:divide-line lg:px-12">
            {TRUST.map((t) => (
              <li key={t.title} className="flex items-center gap-3 lg:justify-center lg:px-4">
                <t.icon className="size-8 shrink-0 text-[#D7141C]" strokeWidth={1.6} aria-hidden />
                <span>
                  <span className="block font-bold text-ink">{t.title}</span>
                  <span className="block text-sm text-ink/70">{t.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicShell>
  );
}

/** Header and footer for the public pages. `fit`: on a laptop or desktop the page fills exactly one screen. */
export function PublicShell({ children, fit = false }: { children: ReactNode; fit?: boolean }) {
  const [checkOpen, setCheckOpen] = useState(false);
  return (
    <div className={`flex min-h-dvh flex-col bg-white ${fit ? 'lg:h-dvh lg:min-h-[700px]' : ''}`}>
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-8 lg:px-12">
          <Link to="/" aria-label="AutoTalent Grid home">
            <span className="sm:hidden">
              <Wordmark compact />
            </span>
            <span className="hidden sm:inline">
              <Wordmark tagline />
            </span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-8 text-[15px] font-medium text-ink lg:flex">
            <Link to="/register" className="hover:text-[#C8101A]">For Learners</Link>
            <Link to="/join/employer" className="hover:text-[#C8101A]">For Employers</Link>
            <Link to="/join/partner" className="hover:text-[#C8101A]">For Training Partners</Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => setCheckOpen(true)} className="btn hidden h-11 border border-[#D7141C] bg-white px-4 text-sm text-ink hover:bg-brand-tint sm:inline-flex">
              <ScanLine className="size-5 text-[#D7141C]" aria-hidden />
              Check a certificate
            </button>
            <Link to="/login" className="btn-primary h-11 bg-[#C8101A] px-5 hover:bg-brand-hover">
              Sign in
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>
      <main className={`flex-1 ${fit ? 'lg:min-h-0' : ''}`}>{children}</main>
      <footer className="shrink-0 border-t border-line bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <Wordmark tagline />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink/75">
            <Link to="/register" className="hover:text-ink">For Learners</Link>
            <Link to="/join/employer" className="hover:text-ink">For Employers</Link>
            <Link to="/join/partner" className="hover:text-ink">For Training Partners</Link>
            <button type="button" onClick={() => setCheckOpen(true)} className="hover:text-ink">Check a certificate</button>
            <Link to="/privacy" className="hover:text-ink">Privacy notice</Link>
            <Link to="/terms" className="hover:text-ink">Terms of use</Link>
          </nav>
          <p className="text-sm text-ink/70">
            A product of
            <br className="hidden lg:block" /> Big Payrolls Solution Pvt. Ltd.
          </p>
        </div>
      </footer>
      <Modal open={checkOpen} onClose={() => setCheckOpen(false)} title="Check a certificate">
        <CertificateCheck />
      </Modal>
    </div>
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
      <p className="text-sm text-muted">Scan the QR code on the certificate, or enter its code here.</p>
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

