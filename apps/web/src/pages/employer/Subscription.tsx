import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BILLING_CYCLES,
  formatRupees,
  PAID_PLANS,
  PLAN_INFO,
  PLANS,
  yearlySaving,
  type BillingCycle,
  type PaidPlan,
  type PaymentMethod,
  type Plan,
  type SubscriptionDto,
} from '@vta/shared';
import { ArrowLeft, ArrowRight, Briefcase, CalendarDays, Check, ChevronRight, CircleCheck, CreditCard, FileText, Landmark, Lock, Printer, Smartphone, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorNote, Field, Modal, Spinner, Wordmark } from '../../components/ui';
import { useToast } from '../../components/toast';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * Phase 12: employer plans (brand design of 26 Oct 2026). On staging, payment is a marked test: no money moves
 * and no card details are asked for. A real payment provider needs an account and keys from AutoTalent Grid.
 */
export const useSubscription = () => useQuery({ queryKey: ['employer', 'subscription'], queryFn: () => api.get<SubscriptionDto>('/employer/subscription') });

interface Payment {
  id: string;
  plan: PaidPlan;
  cycle: BillingCycle;
  amountPaise: number;
  method: PaymentMethod;
  test: boolean;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
}

const day = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
const per = (c: BillingCycle) => (c === 'monthly' ? 'month' : 'year');
const METHOD_LABEL: Record<PaymentMethod, string> = { card: 'Card', upi: 'UPI', netbanking: 'Net banking' };

export function PlanBadge({ plan }: { plan: Plan }) {
  const tone = plan === 'free' ? 'bg-surface text-ink/75' : 'bg-success-tint text-success';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tone}`}>{PLAN_INFO[plan].name}</span>;
}

function PriceLine({ plan, cycle }: { plan: Plan; cycle: BillingCycle }) {
  const price = PLAN_INFO[plan].price;
  if (!price) return <p className="text-[28px] font-extrabold tracking-tight">Custom</p>;
  return (
    <p>
      <span className="text-[30px] font-extrabold tracking-tight">{formatRupees(price[cycle])}</span>
      <span className="text-muted"> / {per(cycle)}</span>
    </p>
  );
}

function usageText(n: number, limit: number | null) {
  return limit === null ? `${n}` : `${n} / ${limit}`;
}

/** The current-plan card on the employer dashboard. */
export function CurrentPlanCard() {
  const q = useSubscription();
  if (!q.data) return null;
  const s = q.data;
  const cycle = s.cycle ?? 'monthly';
  return (
    <section className="card px-5 py-5" aria-labelledby="plan-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="plan-h" className="flex items-center gap-2 font-semibold">
            Your current plan <PlanBadge plan={s.plan} />
          </h2>
          {s.plan === 'free' ? (
            <p className="mt-1 text-sm text-muted">{s.status === 'expired' ? `Your ${PLAN_INFO[s.lastPaidPlan!].name} plan ended on ${day(s.periodEnd!)}.` : 'Upgrade to post more jobs and see more applicants.'}</p>
          ) : (
            <>
              <div className="mt-1">{s.plan === 'enterprise' || !s.cycle ? <p className="text-lg font-bold">Set up with AutoTalent Grid</p> : <PriceLine plan={s.plan} cycle={cycle} />}</div>
              <p className="text-sm text-muted">Active until {day(s.periodEnd!)}</p>
            </>
          )}
        </div>
        <Link to="/employer/subscription" className="btn-secondary">
          Manage plan
        </Link>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
        <div className="flex items-start gap-2.5">
          <Briefcase className="mt-0.5 size-5 text-ink/60" aria-hidden />
          <div>
            <dd className="text-lg font-bold">{usageText(s.usage.activeJobs, s.usage.activeJobsLimit)}</dd>
            <dt className="text-muted">Active jobs</dt>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Users className="mt-0.5 size-5 text-ink/60" aria-hidden />
          <div>
            <dd className="text-lg font-bold">{usageText(s.usage.applicants, s.usage.applicantsLimit)}</dd>
            <dt className="text-muted">{s.usage.applicantsPer === 'job' ? 'Most applicants on a job' : 'Applicants this month'}</dt>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <CalendarDays className="mt-0.5 size-5 text-ink/60" aria-hidden />
          <div>
            <dd className="text-lg font-bold">{s.plan === 'free' ? '–' : `${daysLeft(s.periodEnd!)} days`}</dd>
            <dt className="text-muted">{s.plan === 'free' ? 'No end date' : 'Left on plan'}</dt>
          </div>
        </div>
      </dl>
    </section>
  );
}

function UsageBar({ label, n, limit, note }: { label: string; n: number; limit: number | null; note?: string }) {
  const pct = limit ? Math.min(100, Math.round((n / limit) * 100)) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-4 py-2.5 text-sm">
      <span>
        {label}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-surface" role="presentation">
        {limit !== null && <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-warning' : 'bg-[#D7141C]'}`} style={{ width: `${pct}%` }} />}
      </span>
      <span className="font-semibold">{limit === null ? `${n} (no limit)` : `${n} / ${limit}`}</span>
    </div>
  );
}

/** Subscription: current plan, usage and billing history. */
export function SubscriptionPage() {
  const { can } = useAuth();
  const q = useSubscription();
  const payments = useQuery({ queryKey: ['employer', 'subscription', 'payments'], queryFn: () => api.get<{ items: Payment[] }>('/employer/subscription/payments') });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const s = q.data!;
  const canBuy = can('employer.subscription');
  return (
    <>
      <h1 className="text-[26px] font-bold tracking-tight">Subscription</h1>
      <p className="mt-1 text-muted">Your plan, usage and billing details.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  Current plan <PlanBadge plan={s.plan} />
                </h2>
                <div className="mt-1">
                  {s.plan === 'free' ? (
                    <p className="text-[30px] font-extrabold tracking-tight">₹0</p>
                  ) : s.cycle ? (
                    <PriceLine plan={s.plan} cycle={s.cycle} />
                  ) : (
                    <p className="text-lg font-bold">Set up with AutoTalent Grid</p>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {s.plan !== 'free'
                    ? `Active until ${day(s.periodEnd!)}. Plans do not renew by themselves: pay again before then to continue.`
                    : s.status === 'expired'
                      ? `Your ${PLAN_INFO[s.lastPaidPlan!].name} plan ended on ${day(s.periodEnd!)}.`
                      : 'Free has no end date.'}
                </p>
              </div>
              {canBuy && s.plan !== 'enterprise' && (
                <div className="flex w-full flex-col gap-2 sm:w-auto">
                  <Link to="/employer/subscription/plans" className="btn-primary h-11 px-6">
                    {s.plan === 'free' ? 'Upgrade plan' : 'Change plan'}
                  </Link>
                  {s.plan !== 'free' && s.cycle && (
                    <Link to={`/employer/subscription/checkout?plan=${s.plan}&cycle=${s.cycle}`} className="btn-secondary h-11 px-6">
                      Renew {PLAN_INFO[s.plan].name}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="card px-5 py-4" aria-labelledby="usage-h">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="usage-h" className="font-semibold">
                Plan usage
              </h2>
              {s.usage.applicantsPer === 'month' && <p className="text-sm text-muted">Applicant count resets on {day(`${s.usage.resetsOn}T00:00:00+05:30`)}</p>}
            </div>
            <div className="mt-1 divide-y divide-line">
              <UsageBar label="Active jobs" note="Waiting for review, live or paused" n={s.usage.activeJobs} limit={s.usage.activeJobsLimit} />
              <UsageBar label="Applicants" note={s.usage.applicantsPer === 'job' ? 'Most on one job' : 'This month'} n={s.usage.applicants} limit={s.usage.applicantsLimit} />
              <div className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-4 py-2.5 text-sm">
                <span>Team members</span>
                <span />
                <span className="font-semibold">{s.usage.teamMembers}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card px-5 py-4" aria-labelledby="billing-h">
            <h2 id="billing-h" className="flex items-center gap-2 font-semibold">
              <FileText className="size-5 text-ink/60" aria-hidden />
              Billing history
            </h2>
            {payments.isLoading ? (
              <Spinner />
            ) : !payments.data?.items.length ? (
              <p className="mt-2 text-sm text-muted">No payments yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {payments.data.items.map((p) => (
                  <li key={p.id}>
                    <Link to={`/employer/subscription/invoices/${p.id}`} className="flex items-center gap-3 py-2.5 hover:text-brand">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.invoiceNumber}</span>
                        <span className="block text-muted">
                          {PLAN_INFO[p.plan].name}, {formatRupees(p.amountPaise)}, {day(p.paidAt)}
                          {p.test ? ' (test)' : ''}
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!canBuy && <p className="text-sm text-muted">Only your company&apos;s employer admin can change the plan.</p>}
        </aside>
      </div>
    </>
  );
}

function CycleToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (c: BillingCycle) => void }) {
  return (
    <div role="radiogroup" aria-label="Billing" className="inline-flex rounded-xl border border-line bg-white p-1">
      {BILLING_CYCLES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={cycle === c}
          onClick={() => onChange(c)}
          className={`h-9 rounded-lg px-5 text-sm font-semibold transition-colors ${cycle === c ? 'bg-[#C8101A] text-white' : 'text-ink hover:bg-surface'}`}
        >
          {c === 'monthly' ? 'Monthly' : 'Yearly'}
          {c === 'yearly' && <span className={`ml-2 font-medium ${cycle === c ? 'text-white/90' : 'text-[#C8101A]'}`}>Save up to {yearlySaving('growth')}%</span>}
        </button>
      ))}
    </div>
  );
}

/** Choose a plan. */
export function PlansPage() {
  const [params, setParams] = useSearchParams();
  const cycle: BillingCycle = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const q = useSubscription();
  const [asking, setAsking] = useState(false);
  if (q.isLoading) return <Spinner />;
  const current = q.data?.plan ?? 'free';
  return (
    <>
      <Link to="/employer/subscription" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Subscription
      </Link>
      <div className="mt-3 text-center">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Simple plans for your hiring needs</h1>
        <p className="mt-1 text-muted">Post jobs, find skilled technicians and hire faster.</p>
        <div className="mt-5">
          <CycleToggle cycle={cycle} onChange={(c) => setParams({ cycle: c }, { replace: true })} />
        </div>
      </div>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const info = PLAN_INFO[p];
          const popular = p === 'starter';
          const isCurrent = p === current;
          return (
            <li key={p} className={`relative flex flex-col rounded-2xl border bg-white px-5 pt-6 pb-5 ${popular ? 'border-2 border-[#D7141C] shadow-[0_10px_30px_-12px_rgba(215,20,28,0.45)]' : 'border-line'} ${p === 'growth' || p === 'enterprise' ? 'bg-[#F7F9FC]' : ''}`}>
              {popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#D7141C] px-3 py-0.5 text-xs font-semibold text-white">Most popular</span>}
              <h2 className={`text-xl font-bold ${popular ? 'text-[#C8101A]' : ''}`}>{info.name}</h2>
              <p className="text-sm text-muted">{info.tagline}</p>
              <div className="mt-4 min-h-[64px]">
                {info.price ? (
                  <>
                    <PriceLine plan={p} cycle={cycle} />
                    {cycle === 'yearly' && p !== 'free' && <p className="text-sm text-[#C8101A]">Save {yearlySaving(p as PaidPlan)}% on 12 months</p>}
                  </>
                ) : (
                  <p className="text-[28px] font-extrabold tracking-tight">Custom</p>
                )}
              </div>
              <ul className="mt-4 flex-1 space-y-2.5 text-sm">
                {info.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {isCurrent ? (
                  <p className="flex h-11 items-center justify-center rounded-lg bg-surface text-sm font-semibold text-ink/75">Your current plan</p>
                ) : p === 'free' ? (
                  <p className="flex h-11 items-center justify-center text-center text-sm text-muted">{current === 'free' ? '' : 'You return to Free when a paid plan ends'}</p>
                ) : p === 'enterprise' ? (
                  <button type="button" className="btn-secondary h-11 w-full" onClick={() => setAsking(true)}>
                    Contact sales
                  </button>
                ) : (
                  <Link to={`/employer/subscription/plans/${p}?cycle=${cycle}`} className={`${popular ? 'btn-primary bg-[#C8101A]' : 'btn-secondary'} h-11 w-full`} aria-label={`Choose ${info.name}`}>
                    Choose plan
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-center text-sm text-muted">Prices in Indian rupees. GST applicable. Plans do not renew by themselves.</p>
      {asking && <RequestPlanModal plan="enterprise" onClose={() => setAsking(false)} />}
    </>
  );
}

function RequestPlanModal({ plan, cycle, onClose }: { plan: 'starter' | 'growth' | 'enterprise'; cycle?: BillingCycle; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/employer/subscription/request', { plan, cycle, note: note || undefined }),
    onSuccess: () => {
      toast('success', 'Sent. AutoTalent Grid will contact you.');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ask about ${PLAN_INFO[plan].name}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Sending…' : 'Send to AutoTalent Grid'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">AutoTalent Grid will contact your company to set up the plan.</p>
      {m.error && <ErrorNote message={(m.error as Error).message} />}
      <Field label="Anything we should know? (optional)" htmlFor="plan-note">
        <textarea id="plan-note" className="field-input min-h-24" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, number of branches and hiring needs" />
      </Field>
    </Modal>
  );
}

const isPaid = (p: string | undefined): p is PaidPlan => (PAID_PLANS as readonly string[]).includes(p ?? '');

/** Plan details & features, before paying. */
export function PlanDetailPage() {
  const { plan } = useParams();
  const [params] = useSearchParams();
  const cycle: BillingCycle = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const { can } = useAuth();
  if (!isPaid(plan)) return <ErrorNote message="That plan was not found." />;
  const info = PLAN_INFO[plan];
  const price = info.price!;
  return (
    <div className="mx-auto max-w-xl">
      <Link to={`/employer/subscription/plans?cycle=${cycle}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Back to plans
      </Link>
      <section className="card mt-3 px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">{info.name} Plan</h1>
          {plan === 'starter' && <span className="rounded-full bg-[#D7141C] px-3 py-0.5 text-xs font-semibold text-white">Most popular</span>}
        </div>
        <p className="text-muted">{info.tagline}.</p>
        <div className="mt-5">
          <PriceLine plan={plan} cycle={cycle} />
          <p className="text-sm text-muted">
            {cycle === 'monthly' ? (
              <>
                or {formatRupees(price.yearly)} / year <span className="text-[#C8101A]">(save {yearlySaving(plan)}%)</span>
              </>
            ) : (
              <>or {formatRupees(price.monthly)} / month</>
            )}
          </p>
        </div>
        <ul className="mt-5 space-y-3 border-t border-line pt-5">
          {info.features.map((f) => (
            <li key={f} className="flex gap-3">
              <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
        {can('employer.subscription') ? (
          <Link to={`/employer/subscription/checkout?plan=${plan}&cycle=${cycle}`} className="btn-primary mt-6 h-12 w-full bg-[#C8101A] text-base">
            Continue to payment
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <p className="mt-6 rounded-lg bg-surface px-4 py-3 text-sm">Only your company&apos;s employer admin can buy a plan. Ask them to upgrade.</p>
        )}
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-muted">
          <Lock className="size-4" aria-hidden />
          GST applicable. Plans do not renew by themselves.
        </p>
      </section>
    </div>
  );
}

const METHODS: { id: PaymentMethod; icon: typeof CreditCard }[] = [
  { id: 'card', icon: CreditCard },
  { id: 'upi', icon: Smartphone },
  { id: 'netbanking', icon: Landmark },
];

/** Payment details. In test mode no card details are collected; a payment provider shows its own secure form. */
export function CheckoutPage() {
  const [params] = useSearchParams();
  const plan = params.get('plan') ?? undefined;
  const cycle: BillingCycle = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sub = useSubscription();
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [terms, setTerms] = useState(false);
  const [asking, setAsking] = useState(false);
  const pay = useMutation({
    mutationFn: () => api.post<{ paymentId: string }>('/employer/subscription/checkout', { plan, cycle, method, acceptTerms: terms }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['employer'] });
      navigate(`/employer/subscription/invoices/${r.paymentId}?paid=1`, { replace: true });
    },
  });
  if (!isPaid(plan)) return <ErrorNote message="Choose a plan first." />;
  if (sub.isLoading) return <Spinner />;
  const s = sub.data!;
  const info = PLAN_INFO[plan];
  const amount = info.price![cycle];
  const err = pay.error instanceof ApiError ? pay.error : null;
  const renewing = s.plan === plan && s.cycle === cycle;
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-[26px] font-bold tracking-tight">Payment details</h1>

      <section className="card mt-5 flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-lg font-bold">{info.name} Plan</p>
          <p>
            <span className="text-xl font-extrabold">{formatRupees(amount)}</span> <span className="text-sm text-muted">/ {per(cycle)}</span>
          </p>
        </div>
        <Link to={`/employer/subscription/plans?cycle=${cycle}`} className="text-sm font-semibold text-[#C8101A] hover:underline">
          Change plan
        </Link>
      </section>
      <p className="mt-2 text-sm text-muted">
        {renewing
          ? `Adds one ${per(cycle)} after your current plan ends on ${day(s.periodEnd!)}.`
          : s.plan !== 'free'
            ? `Starts today and replaces your ${PLAN_INFO[s.plan].name} plan straight away. Time left on it is not refunded.`
            : `Starts today and lasts one ${per(cycle)}.`}
      </p>

      {s.paymentMode === 'none' ? (
        <section className="card mt-5 px-5 py-5">
          <p className="text-sm">Online payment is not switched on yet. Ask AutoTalent Grid and they will set up your plan.</p>
          <button type="button" className="btn-primary mt-4 h-11 w-full" onClick={() => setAsking(true)}>
            Ask AutoTalent Grid for {info.name}
          </button>
          {asking && <RequestPlanModal plan={plan} cycle={cycle} onClose={() => setAsking(false)} />}
        </section>
      ) : (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
        >
          <fieldset>
            <legend className="font-semibold">Select payment method</legend>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={method === m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold ${method === m.id ? 'border-[#D7141C] bg-brand-tint text-[#C8101A]' : 'border-line bg-white hover:bg-surface'}`}
                >
                  <m.icon className="size-4" aria-hidden />
                  {METHOD_LABEL[m.id]}
                </button>
              ))}
            </div>
          </fieldset>
          <p role="note" className="mt-4 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
            <span className="font-semibold">Test payment.</span> This staging copy has no payment provider, so no money is taken and no card or bank details are asked for. Your plan starts as if you had paid by{' '}
            {METHOD_LABEL[method]}.
          </p>
          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#D7141C]" checked={terms} onChange={(e) => setTerms(e.target.checked)} aria-describedby={err?.fields.acceptTerms ? 'terms-error' : undefined} />
            <span>
              I agree to the{' '}
              <Link to="/terms" target="_blank" className="font-medium text-[#C8101A] underline">
                terms of use
              </Link>
              .
            </span>
          </label>
          {err?.fields.acceptTerms && (
            <p id="terms-error" className="field-error" role="alert">
              {err.fields.acceptTerms}
            </p>
          )}
          {err && !err.fields.acceptTerms && (
            <div className="mt-3">
              <ErrorNote message={err.message} />
            </div>
          )}
          <button type="submit" className="btn-primary mt-5 h-12 w-full bg-[#C8101A] text-base" disabled={pay.isPending}>
            {pay.isPending ? 'Paying…' : `Pay ${formatRupees(amount)}`}
          </button>
        </form>
      )}
    </div>
  );
}

interface InvoiceView extends Payment {
  company: { name: string; city: string | null; email: string | null };
  paidByName: string;
}

/** Payment success (right after paying) and the invoice/receipt, printable. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const justPaid = params.get('paid') === '1';
  const q = useQuery({ queryKey: ['employer', 'subscription', 'invoice', id], queryFn: () => api.get<InvoiceView>(`/employer/subscription/payments/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const p = q.data!;
  const rows: [string, string][] = [
    ['Plan', PLAN_INFO[p.plan].name],
    ['Amount', `${formatRupees(p.amountPaise)} / ${per(p.cycle)}`],
    ['Active until', day(p.periodEnd)],
    ['Invoice', p.invoiceNumber],
  ];
  return (
    <div className="mx-auto max-w-xl">
      {justPaid && (
        <section className="mb-6 text-center print:hidden">
          <CircleCheck className="mx-auto size-16 text-success" aria-hidden />
          <h1 className="mt-3 text-[28px] font-bold tracking-tight">Payment successful!</h1>
          <p className="text-muted">Your {PLAN_INFO[p.plan].name} plan is now active.</p>
          {p.test && <p className="mt-2 text-sm text-warning">Test payment: no money was taken.</p>}
          <dl className="card mt-5 divide-y divide-line text-left text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-5 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid gap-2">
            <Link to="/employer" className="btn-primary h-12 bg-[#C8101A] text-base">
              Go to dashboard
              <ArrowRight className="size-5" aria-hidden />
            </Link>
            <a href="#invoice" className="btn-secondary h-12 text-base">
              View invoice
            </a>
          </div>
        </section>
      )}

      {!justPaid && (
        <Link to="/employer/subscription" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink print:hidden">
          <ArrowLeft className="size-4" aria-hidden />
          Subscription
        </Link>
      )}
      <article id="invoice" className="card mt-3 px-6 py-6 print:border-0 print:shadow-none" aria-label={`Invoice ${p.invoiceNumber}`}>
        <div className="flex items-start justify-between gap-4">
          <Wordmark tagline />
          <div className="text-right">
            <p className="text-lg font-bold">{p.test ? 'Receipt (test)' : 'Receipt'}</p>
            <p className="text-sm text-muted">{p.invoiceNumber}</p>
          </div>
        </div>
        {p.test && <p className="mt-4 rounded-lg bg-warning-tint px-4 py-2.5 text-sm text-warning">Test payment on a staging copy: no money was taken. Not a tax invoice.</p>}
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted">Billed to</dt>
            <dd className="font-semibold">{p.company.name}</dd>
            {p.company.city && <dd>{p.company.city}</dd>}
            {p.company.email && <dd>{p.company.email}</dd>}
          </div>
          <div className="text-right">
            <dt className="text-muted">Paid on</dt>
            <dd className="font-semibold">{day(p.paidAt)}</dd>
            <dd>
              by {p.paidByName}, {METHOD_LABEL[p.method]}
            </dd>
          </div>
        </dl>
        <table className="mt-5 w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="py-3">
                AutoTalent Grid {PLAN_INFO[p.plan].name} plan, {p.cycle}
                <span className="block text-muted">
                  {day(p.periodStart)} to {day(p.periodEnd)}
                </span>
              </td>
              <td className="py-3 text-right font-semibold">{formatRupees(p.amountPaise)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 font-semibold">Total</td>
              <td className="pt-3 text-right text-lg font-bold">{formatRupees(p.amountPaise)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-5 text-xs text-muted">GST details, the seller&apos;s GSTIN and address are added once AutoTalent Grid confirms them.</p>
        <button type="button" className="btn-secondary mt-5 print:hidden" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print or save as PDF
        </button>
      </article>
    </div>
  );
}
