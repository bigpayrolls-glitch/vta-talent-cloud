import { useMutation, useQuery } from '@tanstack/react-query';
import {
  COURSE_LEVEL_LABEL,
  COURSE_SORT_LABEL,
  COURSE_SORTS,
  DELIVERY_MODES,
  DURATION_BUCKET_LABEL,
  DURATION_BUCKETS,
  FEE_BUCKET_LABEL,
  FEE_BUCKETS,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  SKILL_AREA_LABEL,
  SKILL_AREAS,
  type CatalogueCourse,
  type CatalogueCourseDetail,
  type PayMethod,
  type SkillArea,
} from '@vta/shared';
import { ArrowLeft, ArrowRight, Award, Building2, CalendarDays, Check, CircleCheck, Clock, CreditCard, Landmark, MapPin, Printer, School, SlidersHorizontal, Smartphone, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { durationText } from '../../components/form';
import { EmptyState, ErrorNote, Spinner, Wordmark } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PublicShell } from './Home';

/**
 * Phase 13: public course catalogue and learner self-enrolment (brand design of 26 Oct 2026).
 * Photos are placeholders per skill area until AutoTalent Grid supplies course photos.
 * No ratings or reviews are shown: none are collected yet.
 */
export const courseImage = (skillArea: string) => `/courses/${(SKILL_AREAS as readonly string[]).includes(skillArea) ? skillArea : 'other'}.webp`;
const MODE_LABEL: Record<string, string> = { classroom: 'Classroom', online: 'Online', blended: 'Classroom and online' };
const rupees = (n: number) => (n === 0 ? 'Free' : `₹${n.toLocaleString('en-IN')}`);
const day = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));
const monthYear = (d: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));

function Meta({ icon: Icon, children }: { icon: typeof Clock; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-ink/55" aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- listing

function CheckGroup<T extends string>({ legend, options, labels, value, onChange }: { legend: string; options: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="border-t border-line pt-4">
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="mt-2 space-y-1.5">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-[#D7141C]" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} />
            {labels[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const list = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean);
  const city = params.get('city') ?? '';
  const sort = (params.get('sort') ?? 'soonest') as (typeof COURSE_SORTS)[number];
  const query = params.toString();
  const q = useQuery({
    queryKey: ['public', 'courses', query],
    queryFn: () => api.get<{ items: CatalogueCourse[]; total: number; cities: string[] }>(`/public/courses${query ? `?${query}` : ''}`),
    placeholderData: (p) => p,
  });
  const set = (k: string, v: string | string[]) => {
    const n = new URLSearchParams(params);
    const s = Array.isArray(v) ? v.join(',') : v;
    if (s) n.set(k, s);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const active = ['city', 'skill', 'mode', 'duration', 'fee'].some((k) => params.get(k));

  const filters = (
    <div className="space-y-4">
      <div>
        <label htmlFor="f-city" className="text-sm font-semibold">
          Location
        </label>
        <select id="f-city" className="field-input mt-2" value={city} onChange={(e) => set('city', e.target.value)}>
          <option value="">All locations</option>
          {(q.data?.cities ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <CheckGroup legend="Course category" options={SKILL_AREAS} labels={SKILL_AREA_LABEL} value={list('skill') as SkillArea[]} onChange={(v) => set('skill', v)} />
      <CheckGroup legend="Training mode" options={DELIVERY_MODES} labels={MODE_LABEL as Record<(typeof DELIVERY_MODES)[number], string>} value={list('mode') as (typeof DELIVERY_MODES)[number][]} onChange={(v) => set('mode', v)} />
      <CheckGroup legend="Duration" options={DURATION_BUCKETS} labels={DURATION_BUCKET_LABEL} value={list('duration') as (typeof DURATION_BUCKETS)[number][]} onChange={(v) => set('duration', v)} />
      <CheckGroup legend="Fee" options={FEE_BUCKETS} labels={FEE_BUCKET_LABEL} value={list('fee') as (typeof FEE_BUCKETS)[number][]} onChange={(v) => set('fee', v)} />
      {active && (
        <button type="button" className="text-sm font-semibold text-[#C8101A] underline" onClick={() => setParams(sort !== 'soonest' ? { sort } : {}, { replace: true })}>
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <PublicShell>
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[240px_1fr] lg:px-12">
        <aside aria-label="Filters" className="hidden lg:block">
          <h2 className="mb-4 font-bold">Filters</h2>
          {filters}
        </aside>
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[28px] font-bold tracking-tight">Training courses</h1>
              <p className="text-sm text-muted" aria-live="polite">
                {q.data ? `${q.data.total} ${q.data.total === 1 ? 'course' : 'courses'} with batches open for enrolment` : ' '}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary lg:hidden" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal className="size-4" aria-hidden />
                Filters
              </button>
              <label htmlFor="f-sort" className="text-sm text-muted">
                Sort by
              </label>
              <select id="f-sort" className="field-input w-auto" value={sort} onChange={(e) => set('sort', e.target.value === 'soonest' ? '' : e.target.value)}>
                {COURSE_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {COURSE_SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {q.isLoading ? (
            <Spinner />
          ) : q.isError ? (
            <div className="mt-6">
              <ErrorNote message={(q.error as Error).message} />
            </div>
          ) : !q.data!.items.length ? (
            <div className="card mt-6">
              <EmptyState title="No courses match" body={active ? 'Try fewer filters.' : 'New batches are added regularly. Check back soon.'} />
            </div>
          ) : (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {q.data!.items.map((c) => (
                <li key={c.id} className="card flex flex-col overflow-hidden">
                  <img src={courseImage(c.skillArea)} alt="" className="aspect-[16/10] w-full object-cover" loading="lazy" />
                  <div className="flex flex-1 flex-col px-4 py-4">
                    <h2 className="font-bold leading-snug">{c.title}</h2>
                    <p className="text-sm text-muted">{COURSE_LEVEL_LABEL[c.level as keyof typeof COURSE_LEVEL_LABEL] ?? c.level}</p>
                    <div className="mt-3 space-y-1.5 text-[13px] text-ink/80">
                      <Meta icon={Building2}>{c.providers.join(', ')}</Meta>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <Meta icon={Clock}>{durationText(c.durationValue, c.durationUnit)}</Meta>
                        <Meta icon={School}>{MODE_LABEL[c.deliveryMode] ?? c.deliveryMode}</Meta>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <Meta icon={MapPin}>{c.cities.join(', ') || 'Online'}</Meta>
                        <Meta icon={CalendarDays}>Starts {day(c.nextStart)}</Meta>
                      </div>
                    </div>
                    <p className="mt-3 text-xl font-extrabold">{rupees(c.feeRupees)}</p>
                    <Link to={`/courses/${c.id}`} className="btn-primary mt-3 h-10 bg-[#C8101A] hover:bg-brand-hover" aria-label={`View details: ${c.title}`}>
                      View details
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {filtersOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" className="absolute inset-0 bg-ink/40" onClick={() => setFiltersOpen(false)} aria-label="Close filters" />
          <div className="absolute inset-y-0 right-0 w-[85%] max-w-sm overflow-y-auto bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Filters</h2>
              <button type="button" className="rounded-lg p-2 hover:bg-surface" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                <X className="size-5" />
              </button>
            </div>
            {filters}
            <button type="button" className="btn-primary mt-6 w-full" onClick={() => setFiltersOpen(false)}>
              Show {q.data?.total ?? ''} courses
            </button>
          </div>
        </div>
      )}
    </PublicShell>
  );
}

// ---------------------------------------------------------------- course details

const TABS = ['Overview', 'Syllabus', 'Certification'] as const;

export function CourseDetailPage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const q = useQuery({ queryKey: ['public', 'course', id], queryFn: () => api.get<CatalogueCourseDetail>(`/public/courses/${id}`) });
  if (q.isLoading)
    return (
      <PublicShell>
        <Spinner />
      </PublicShell>
    );
  if (q.isError)
    return (
      <PublicShell>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      </PublicShell>
    );
  const c = q.data!;
  const first = c.batches.find((b) => b.seatsLeft > 0);
  return (
    <PublicShell>
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 lg:px-12">
        <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          Back to courses
        </Link>
        <section className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          <img src={courseImage(c.skillArea)} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover" />
          <div>
            <p className="text-[13px] font-semibold tracking-wide text-[#C8101A] uppercase">{SKILL_AREA_LABEL[c.skillArea as SkillArea] ?? c.skillArea}</p>
            <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight sm:text-[32px]">
              {c.title} <span className="font-semibold text-ink/70">({COURSE_LEVEL_LABEL[c.level as keyof typeof COURSE_LEVEL_LABEL] ?? c.level})</span>
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink/80">
              {c.providers.length > 0 && <Meta icon={Building2}>{c.providers.join(', ')}</Meta>}
              {c.cities.length > 0 && <Meta icon={MapPin}>{c.cities.join(', ')}</Meta>}
              <Meta icon={Clock}>{durationText(c.durationValue, c.durationUnit)}</Meta>
              <Meta icon={School}>{MODE_LABEL[c.deliveryMode] ?? c.deliveryMode}</Meta>
              <Meta icon={Award}>Certificate</Meta>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <p className="text-[32px] font-extrabold tracking-tight">{rupees(c.feeRupees)}</p>
              {first ? (
                <Link to={`/enrol/${first.id}`} className="btn-primary h-12 min-w-[220px] bg-[#C8101A] px-8 text-base hover:bg-brand-hover">
                  Enrol now
                </Link>
              ) : (
                <p className="text-sm text-muted">No batch open for enrolment right now.</p>
              )}
            </div>
            {first && <p className="mt-2 text-sm text-muted">Next batch starts {day(first.startDate)}. Your seat is confirmed straight away.</p>}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="card">
            <div role="tablist" aria-label="Course information" className="flex gap-1 overflow-x-auto border-b border-line px-3">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap ${tab === t ? 'border-[#D7141C] text-[#C8101A]' : 'border-transparent text-muted hover:text-ink'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="px-5 py-5">
              {tab === 'Overview' && (
                <>
                  <h2 className="font-bold">About this course</h2>
                  <p className="mt-2 whitespace-pre-line text-ink/80">{c.description || `${c.title}: hands-on training at a workshop centre, assessed by your trainer.`}</p>
                  {c.skills.length > 0 && (
                    <>
                      <h2 className="mt-6 font-bold">What you will learn</h2>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {c.skills.map((s) => (
                          <li key={s.label} className="flex gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                            {s.label}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {c.prerequisites && (
                    <>
                      <h2 className="mt-6 font-bold">Before you join</h2>
                      <p className="mt-2 whitespace-pre-line text-ink/80">{c.prerequisites}</p>
                    </>
                  )}
                </>
              )}
              {tab === 'Syllabus' && (
                <>
                  <h2 className="font-bold">Skills taught and assessed</h2>
                  <ol className="mt-3 space-y-2">
                    {c.skills.map((s, i) => (
                      <li key={s.label} className="flex gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-[#C8101A]">{i + 1}</span>
                        <span className="pt-0.5">
                          {s.label}
                          {s.required && <span className="ml-2 text-xs text-muted">must pass</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {c.trainingHours && <p className="mt-4 text-sm text-muted">About {c.trainingHours} training hours.</p>}
                </>
              )}
              {tab === 'Certification' && (
                <>
                  <h2 className="font-bold">How you earn the certificate</h2>
                  <ul className="mt-3 space-y-2">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      Attend at least {c.attendanceThresholdPct}% of the sessions.
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      Score at least {c.passMarkPct}% in the trainer&apos;s assessment, passing every must-pass skill.
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      AutoTalent Grid issues your certificate. Employers can check it with its QR code.
                    </li>
                  </ul>
                </>
              )}
            </div>
          </section>

          <aside aria-labelledby="batches-h" className="card h-fit px-5 py-4">
            <h2 id="batches-h" className="font-bold">
              Upcoming batches
            </h2>
            {!c.batches.length ? (
              <p className="mt-2 text-sm text-muted">No batch is open right now.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {c.batches.map((b) => (
                  <li key={b.id} className="flex items-start gap-3 py-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-tint text-center text-[11px] leading-tight font-bold text-[#C8101A]">
                      {monthYear(b.startDate).split(' ')[0]}
                      <br />
                      {new Date(`${b.startDate}T00:00:00`).getDate()}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-semibold">{b.name}</span>
                      <span className="block text-muted">
                        {day(b.startDate)} – {day(b.endDate)}
                      </span>
                      <span className="block text-muted">
                        {b.centre}
                        {b.city ? `, ${b.city}` : ''}
                      </span>
                      <span className={`block ${b.seatsLeft ? 'text-ink/80' : 'font-semibold text-warning'}`}>{b.seatsLeft ? `${b.seatsLeft} seats left` : 'Full'}</span>
                    </span>
                    {b.seatsLeft > 0 && (
                      <Link to={`/enrol/${b.id}`} className="btn-secondary btn-sm border-[#D7141C] text-[#C8101A]" aria-label={`Enrol now: ${b.name}`}>
                        Enrol now
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

// ---------------------------------------------------------------- enrolment and payment

interface Quote {
  batch: { id: string; name: string; startDate: string; endDate: string; centre: string; city: string | null; provider: string; seatsLeft: number };
  course: { id: string; title: string; skillArea: string; deliveryMode: string; durationValue: number; durationUnit: string; feeRupees: number };
  blocker: string | null;
  paymentMode: 'test' | 'none';
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Course and batch', 'Payment', 'Confirmation'];
  return (
    <ol className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Enrolment steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={s} className="flex items-center gap-2 text-sm" aria-current={current ? 'step' : undefined}>
            <span className={`grid size-7 place-items-center rounded-full text-[13px] font-semibold ${current || done ? 'bg-[#D7141C] text-white' : 'bg-surface text-muted'}`}>{done ? <Check className="size-4" aria-hidden /> : n}</span>
            <span className={current ? 'font-semibold text-[#C8101A]' : 'text-ink/75'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

const METHOD_ICON: Record<PayMethod, typeof CreditCard> = { upi: Smartphone, card: CreditCard, netbanking: Landmark };

export function EnrolPage() {
  const { batchId = '' } = useParams();
  const { me, loading, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [method, setMethod] = useState<PayMethod>('upi');
  const [terms, setTerms] = useState(false);
  const isLearner = !!me && can('learner.self');
  const q = useQuery({ queryKey: ['enrol', batchId], queryFn: () => api.get<Quote>(`/me/enrol/${batchId}`), enabled: isLearner });
  const pay = useMutation({
    mutationFn: () => api.post<{ enrolmentId: string }>('/me/enrolments', { batchId, method: q.data?.course.feeRupees ? method : undefined, acceptTerms: terms }),
    onSuccess: (r) => navigate(`/enrol/done/${r.enrolmentId}`, { replace: true }),
  });
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isLearner)
    return (
      <PublicShell>
        <div className="mx-auto max-w-xl px-4 py-12">
          <ErrorNote message="Enrolling is for learner accounts. Sign out and sign in with your learner mobile number." />
        </div>
      </PublicShell>
    );
  const err = pay.error instanceof ApiError ? pay.error : null;
  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <Stepper step={2} />
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="mt-6">
            <ErrorNote message={(q.error as Error).message} />
          </div>
        ) : (
          (() => {
            const d = q.data!;
            const fee = d.course.feeRupees;
            return (
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <section className="card px-5 py-5" aria-labelledby="sel-h">
                  <h1 id="sel-h" className="font-bold">
                    Selected course
                  </h1>
                  <div className="mt-3 flex gap-3">
                    <img src={courseImage(d.course.skillArea)} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                    <div>
                      <p className="font-semibold">{d.course.title}</p>
                      <p className="text-sm text-muted">{d.batch.provider}</p>
                    </div>
                  </div>
                  <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                    <dt className="text-muted">Batch</dt>
                    <dd className="font-medium">{d.batch.name}</dd>
                    <dt className="text-muted">Dates</dt>
                    <dd>
                      {day(d.batch.startDate)} – {day(d.batch.endDate)}
                    </dd>
                    <dt className="text-muted">Location</dt>
                    <dd>
                      {d.batch.centre}
                      {d.batch.city ? `, ${d.batch.city}` : ''}
                    </dd>
                    <dt className="text-muted">Mode</dt>
                    <dd>{MODE_LABEL[d.course.deliveryMode] ?? d.course.deliveryMode}</dd>
                    <dt className="text-muted">Duration</dt>
                    <dd>{durationText(d.course.durationValue, d.course.durationUnit)}</dd>
                    <dt className="text-muted">Seats left</dt>
                    <dd>{d.batch.seatsLeft}</dd>
                  </dl>
                  <Link to={`/courses/${d.course.id}`} className="mt-4 inline-block text-sm font-semibold text-[#C8101A] underline">
                    Choose another batch
                  </Link>
                </section>

                <form
                  className="card px-5 py-5"
                  aria-labelledby="pay-h"
                  onSubmit={(e) => {
                    e.preventDefault();
                    pay.mutate();
                  }}
                >
                  <h2 id="pay-h" className="font-bold">
                    Payment summary
                  </h2>
                  <dl className="mt-3 divide-y divide-line text-sm">
                    <div className="flex justify-between py-2">
                      <dt className="text-muted">Course fee</dt>
                      <dd>{rupees(fee)}</dd>
                    </div>
                    <div className="flex justify-between py-2 text-base">
                      <dt className="font-bold">Total amount</dt>
                      <dd className="font-bold">{rupees(fee)}</dd>
                    </div>
                  </dl>
                  {d.blocker ? (
                    <div className="mt-4">
                      <ErrorNote message={d.blocker} />
                    </div>
                  ) : fee > 0 && d.paymentMode === 'none' ? (
                    <p className="mt-4 rounded-lg bg-surface px-4 py-3 text-sm">Online payment is not switched on yet. Contact the training centre to enrol.</p>
                  ) : (
                    <>
                      {fee > 0 && (
                        <fieldset className="mt-5">
                          <legend className="font-semibold">Select payment method</legend>
                          <div className="mt-2 space-y-2" role="radiogroup" aria-label="Payment method">
                            {PAY_METHODS.map((m) => {
                              const Icon = METHOD_ICON[m];
                              return (
                                <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${method === m ? 'border-[#D7141C] bg-brand-tint' : 'border-line hover:bg-surface'}`}>
                                  <input type="radio" name="method" className="size-4 accent-[#D7141C]" checked={method === m} onChange={() => setMethod(m)} />
                                  <Icon className="size-4 text-ink/60" aria-hidden />
                                  {PAY_METHOD_LABEL[m]}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      )}
                      {fee > 0 && (
                        <p role="note" className="mt-4 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
                          <span className="font-semibold">Test payment.</span> This staging copy has no payment provider: no money is taken and no card or bank details are asked for.
                        </p>
                      )}
                      <label className="mt-4 flex items-start gap-2.5 text-sm">
                        <input type="checkbox" className="mt-0.5 size-4 accent-[#D7141C]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                        <span>
                          I agree to the{' '}
                          <Link to="/terms" target="_blank" className="font-medium text-[#C8101A] underline">
                            terms of use
                          </Link>
                          .
                        </span>
                      </label>
                      {err?.fields.acceptTerms && (
                        <p className="field-error" role="alert">
                          {err.fields.acceptTerms}
                        </p>
                      )}
                      {err && !err.fields.acceptTerms && (
                        <div className="mt-3">
                          <ErrorNote message={err.message} />
                        </div>
                      )}
                      <button type="submit" className="btn-primary mt-5 h-12 w-full bg-[#C8101A] text-base hover:bg-brand-hover" disabled={pay.isPending}>
                        {pay.isPending ? 'Please wait…' : fee > 0 ? `Pay ${rupees(fee)}` : 'Confirm enrolment'}
                      </button>
                    </>
                  )}
                </form>
              </div>
            );
          })()
        )}
      </div>
    </PublicShell>
  );
}

interface Receipt {
  enrolmentId: string;
  receiptNumber: string;
  amountRupees: number;
  method: PayMethod | null;
  test: boolean;
  free: boolean;
  paidAt: string;
  status: string;
  learner: { name: string; code: string };
  course: { title: string; deliveryMode: string; durationValue: number; durationUnit: string };
  batch: { name: string; startDate: string; endDate: string; centre: string; city: string | null; provider: string };
}

const NEXT_STEPS = ['The training centre has your enrolment and will contact you about the batch.', 'Attend the training as per the schedule.', 'Complete the assessment with your trainer.', 'Get certified and apply for jobs.'];

export function EnrolDonePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['enrol', 'receipt', id], queryFn: () => api.get<Receipt>(`/me/enrolments/${id}/receipt`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError)
    return (
      <PublicShell>
        <div className="mx-auto max-w-xl px-4 py-12">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      </PublicShell>
    );
  const r = q.data!;
  const rows: [string, string][] = [
    ['Enrolment ID', r.receiptNumber],
    ['Amount paid', r.free ? 'Free course' : rupees(r.amountRupees)],
    ['Payment status', r.free ? 'Not needed' : r.test ? 'Paid (test)' : 'Paid'],
    ['Batch starts', day(r.batch.startDate)],
    ['Location', `${r.batch.centre}${r.batch.city ? `, ${r.batch.city}` : ''}`],
  ];
  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <div className="print:hidden">
          <Stepper step={3} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <article className="card px-6 py-6" aria-labelledby="done-h">
            <div className="hidden print:block">
              <Wordmark tagline />
            </div>
            <div className="text-center">
              <CircleCheck className="mx-auto size-16 text-success print:hidden" aria-hidden />
              <h1 id="done-h" className="mt-3 text-[26px] font-bold tracking-tight">
                Enrolment successful!
              </h1>
              <p className="text-muted">You are now enrolled in the course.</p>
              {r.test && <p className="mt-1 text-sm text-warning">Test payment: no money was taken. Not a tax invoice.</p>}
            </div>
            <div className="mt-6 flex gap-3 border-t border-line pt-5">
              <div>
                <p className="font-semibold">{r.course.title}</p>
                <p className="text-sm text-muted">
                  {r.batch.name}, {r.batch.provider}
                </p>
                <p className="text-sm text-muted">
                  {r.learner.name} ({r.learner.code})
                </p>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-line text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className={`text-right font-semibold ${k === 'Payment status' ? 'text-success' : ''}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 grid gap-2 print:hidden">
              <Link to="/learn/learning" className="btn-primary h-12 bg-[#C8101A] text-base hover:bg-brand-hover">
                Go to My Courses
                <ArrowRight className="size-5" aria-hidden />
              </Link>
              <button type="button" className="btn-secondary h-12 border-[#D7141C] text-base text-[#C8101A]" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                Download receipt
              </button>
            </div>
          </article>
          <aside className="card h-fit px-5 py-5 print:hidden" aria-labelledby="next-h">
            <h2 id="next-h" className="font-bold">
              What&apos;s next?
            </h2>
            <ol className="mt-3 space-y-4">
              {NEXT_STEPS.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-tint font-semibold text-[#C8101A]">{i + 1}</span>
                  <span className="pt-1">{s}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}
