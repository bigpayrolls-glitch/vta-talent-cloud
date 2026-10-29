import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BILLING_CYCLES,
  formatRupees,
  PARTNER_PLANS,
  partnerPlanTotal,
  PAYMENT_METHODS,
  yearlySaving,
  type BillingCycle,
  type PaidPartnerPlan,
  type PartnerPlan,
  type PartnerSubscriptionDto,
  type PaymentMethod,
} from '@vta/shared';
import { ArrowLeft, Check, CircleCheck, CreditCard, Download, Landmark, Lock, Minus, ReceiptText, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorNote, PageHeader, Spinner, Wordmark } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { usePartnerPlans } from '../../lib/plans';
import { PaymentCancelled, payWithRazorpay, type RazorpayStart } from '../../lib/razorpay';

/**
 * Training partner Subscription & Billing (29 Oct 2026, AutoTalent Grid's design): plans, usage, comparison,
 * billing period, payment method, order summary with GST, and invoices. Prices and limits come from Admin > Plans.
 */

interface Payment {
  id: string;
  plan: string;
  cycle: BillingCycle;
  amountPaise: number;
  gstPaise: number;
  method: string;
  test: boolean;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
}

const day = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
const METHOD_LABEL: Record<string, string> = { card: 'Credit / Debit card', upi: 'UPI', netbanking: 'Net banking', wallet: 'Wallet', other: 'Online payment' };
const METHOD_ICON: Record<PaymentMethod, typeof CreditCard> = { upi: Smartphone, card: CreditCard, netbanking: Landmark };
const isPaid = (p: PartnerPlan): p is PaidPartnerPlan => p !== 'free';

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <p className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold">
          {used}
          {limit !== null ? ` of ${limit}` : ' (no limit)'}
        </span>
      </p>
      {limit !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-surface">
          <div className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-brand' : 'bg-success'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function PartnerSubscriptionPage() {
  const plans = usePartnerPlans();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sub = useQuery({ queryKey: ['partner', 'subscription'], queryFn: () => api.get<PartnerSubscriptionDto>('/partner/subscription') });
  const payments = useQuery({ queryKey: ['partner', 'subscription', 'payments'], queryFn: () => api.get<{ items: Payment[] }>('/partner/subscription/payments') });
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [chosen, setChosen] = useState<PaidPartnerPlan | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [terms, setTerms] = useState(false);
  const [stage, setStage] = useState<'idle' | 'paying' | 'verifying'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: async (): Promise<string | null> => {
      setNote(null);
      const live = sub.data?.paymentMode === 'razorpay';
      const r = await api.post<{ paymentId: string } | RazorpayStart>('/partner/subscription/checkout', { plan: chosen, cycle, method: live ? undefined : method, acceptTerms: terms });
      if (!('razorpay' in r)) return r.paymentId;
      setStage('paying');
      try {
        const out = await payWithRazorpay(r, () => setStage('verifying'));
        if (out.status === 'needs_refund') {
          setNote(out.message);
          return null;
        }
        return out.purpose === 'plan' ? out.paymentId : null;
      } catch (e) {
        if (e instanceof PaymentCancelled) {
          setNote(e.message);
          return null;
        }
        throw e;
      } finally {
        setStage('idle');
      }
    },
    onSuccess: async (id) => {
      if (!id) return;
      await qc.invalidateQueries({ queryKey: ['partner', 'subscription'] });
      navigate(`/partner/subscription/invoices/${id}?paid=1`);
    },
  });

  if (sub.isLoading) return <Spinner />;
  if (sub.isError) return <ErrorNote message={(sub.error as Error).message} />;
  const s = sub.data!;
  const saving = Math.max(...PARTNER_PLANS.filter(isPaid).map((p) => yearlySaving(plans[p].price)));
  const order = chosen ? partnerPlanTotal(plans[chosen], cycle) : null;
  const err = pay.error instanceof ApiError ? pay.error : null;

  return (
    <div>
      <PageHeader
        title="Subscription & Billing"
        description="Choose a plan that fits your training operations."
        actions={
          <a href="#invoices" className="btn-secondary">
            <ReceiptText className="size-4" aria-hidden />
            View billing history
          </a>
        }
      />

      <section className="card mb-6 grid gap-5 px-5 py-4 md:grid-cols-[1fr_2fr]" aria-labelledby="current-h">
        <div>
          <h2 id="current-h" className="text-sm text-muted">
            Current plan
          </h2>
          <p className="text-xl font-bold">{plans[s.plan].name}</p>
          <p className="text-sm text-muted">
            {s.status === 'active' && s.periodEnd
              ? `Active until ${day(s.periodEnd)}${s.source === 'admin' ? ' (set by AutoTalent Grid)' : ''}`
              : s.status === 'expired' && s.lastPaidPlan
                ? `Your ${plans[s.lastPaidPlan].name} plan ended on ${day(s.periodEnd!)}.`
                : 'Free plan'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <UsageMeter label="Active courses" used={s.usage.activeCourses} limit={s.usage.activeCoursesLimit} />
          <UsageMeter label="Active batches" used={s.usage.activeBatches} limit={s.usage.activeBatchesLimit} />
          <UsageMeter label="Learners" used={s.usage.learners} limit={s.usage.learnersLimit} />
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Subscription plans</h2>
        <div className="inline-flex rounded-full border border-line p-1" role="radiogroup" aria-label="Billing cycle">
          {BILLING_CYCLES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${cycle === c ? 'bg-[#C8101A] text-white' : 'text-ink/75'}`}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
              {c === 'yearly' && saving > 0 && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] ${cycle === c ? 'bg-white/20' : 'bg-success-tint text-success'}`}>Save {saving}%</span>}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-4 lg:grid-cols-3">
        {PARTNER_PLANS.map((code) => {
          const p = plans[code];
          const current = s.plan === code;
          const selected = chosen === code;
          return (
            <li key={code} className={`card relative flex flex-col px-5 py-5 ${p.recommended ? 'border-2 border-[#D7141C] bg-brand-tint/40' : ''} ${selected ? 'ring-2 ring-[#D7141C]' : ''}`}>
              {p.recommended && <span className="mb-2 w-fit rounded-full bg-[#C8101A] px-2.5 py-0.5 text-[11px] font-semibold text-white">Recommended</span>}
              <h3 className="text-lg font-bold">{p.name}</h3>
              <p className="mt-1">
                <span className="text-[28px] font-extrabold tracking-tight">{formatRupees(p.price[cycle])}</span>
                {isPaid(code) && <span className="text-sm text-muted"> / {cycle === 'monthly' ? 'month' : 'year'}</span>}
              </p>
              <p className="text-sm text-muted">
                {isPaid(code) ? (cycle === 'monthly' ? `(${formatRupees(p.price.yearly)} / year)` : `(${formatRupees(p.price.monthly)} / month)`) : p.tagline}
                {isPaid(code) && p.gstPct > 0 ? `, plus ${p.gstPct}% GST` : ''}
              </p>
              <ul className="my-4 space-y-2 border-t border-line pt-4 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {current ? (
                  <button type="button" className="btn-secondary h-11 w-full" disabled>
                    Current plan
                  </button>
                ) : isPaid(code) ? (
                  <button
                    type="button"
                    className={`h-11 w-full ${p.recommended ? 'btn-primary bg-[#C8101A]' : 'btn-secondary'}`}
                    onClick={() => {
                      setChosen(code);
                      requestAnimationFrame(() => document.getElementById('order-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }}
                  >
                    {s.plan === 'free' && p.recommended ? 'Upgrade now' : 'Choose plan'}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="card mt-6 overflow-x-auto" aria-labelledby="compare-h">
        <h2 id="compare-h" className="px-5 pt-4 text-lg font-bold">
          Plan comparison
        </h2>
        <p className="px-5 text-sm text-muted">Compare features across all plans.</p>
        <table className="mt-3 w-full min-w-[560px] text-sm">
          <thead className="bg-surface text-left">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Features</th>
              {PARTNER_PLANS.map((c) => (
                <th key={c} className="px-3 py-2.5 text-center font-semibold">
                  {plans[c].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(
              [
                ['Active courses', (c: PartnerPlan) => limit(plans[c].activeCourses)],
                ['Active batches', (c: PartnerPlan) => limit(plans[c].activeBatches)],
                ['Learners', (c: PartnerPlan) => limit(plans[c].learners)],
                ['Trainer management', (c: PartnerPlan) => tick(plans[c].trainerManagement)],
                ['Assessments', (c: PartnerPlan) => plans[c].assessments || dash],
                ['Certificates', (c: PartnerPlan) => tick(plans[c].certificates)],
                ['Reports', (c: PartnerPlan) => plans[c].reports || dash],
                ['API access', (c: PartnerPlan) => tick(plans[c].apiAccess)],
                ['Support', (c: PartnerPlan) => plans[c].support || dash],
              ] as const
            ).map(([label, cell]) => (
              <tr key={label}>
                <th scope="row" className="px-5 py-2.5 text-left font-normal">
                  {label}
                </th>
                {PARTNER_PLANS.map((c) => (
                  <td key={c} className="px-3 py-2.5 text-center">
                    {cell(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {chosen && order && (
        <form
          className="card mt-6 px-5 py-5"
          aria-labelledby="order-h"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
        >
          <h2 id="order-h" className="text-lg font-bold">
            Order summary
          </h2>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between">
              <dt className="text-muted">Plan</dt>
              <dd className="font-semibold">{plans[chosen].name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Subscription amount</dt>
              <dd>{formatRupees(order.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Billing cycle</dt>
              <dd className="font-semibold">{cycle === 'monthly' ? 'Monthly' : 'Yearly'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">GST ({plans[chosen].gstPct}%)</dt>
              <dd>{formatRupees(order.gst)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base sm:col-span-2">
              <dt className="font-bold">Total amount</dt>
              <dd className="font-bold">{formatRupees(order.total)}</dd>
            </div>
          </dl>
          {s.plan !== 'free' && s.plan !== chosen && <p className="mt-3 rounded-lg bg-surface px-4 py-2.5 text-sm">The new plan starts today and replaces your {plans[s.plan].name} plan. Time left on it is not refunded.</p>}
          {s.paymentMode === 'none' ? (
            <p className="mt-4 rounded-lg bg-surface px-4 py-3 text-sm">Online payment is not switched on yet. Contact AutoTalent Grid to set up your plan.</p>
          ) : (
            <>
              {s.paymentMode === 'test' && (
                <fieldset className="mt-5">
                  <legend className="font-semibold">Payment method</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
                    {PAYMENT_METHODS.map((m) => {
                      const Icon = METHOD_ICON[m];
                      return (
                        <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${method === m ? 'border-[#D7141C] bg-brand-tint' : 'border-line hover:bg-surface'}`}>
                          <input type="radio" name="method" className="size-4 accent-[#D7141C]" checked={method === m} onChange={() => setMethod(m)} />
                          <Icon className="size-4 text-ink/60" aria-hidden />
                          {METHOD_LABEL[m]}
                        </label>
                      );
                    })}
                  </div>
                  <p role="note" className="mt-3 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
                    <span className="font-semibold">Test payment.</span> This staging copy has no payment provider: no money is taken and no card or bank details are asked for.
                  </p>
                </fieldset>
              )}
              <label className="mt-4 flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#D7141C]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <Link to="/terms" target="_blank" className="font-medium text-[#C8101A] underline">
                    terms of use
                  </Link>{' '}
                  and the{' '}
                  <Link to="/privacy" target="_blank" className="font-medium text-[#C8101A] underline">
                    privacy notice
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
              {note && (
                <p role="status" className="mt-3 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
                  {note}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Lock className="size-3.5" aria-hidden />
                  {s.paymentMode === 'razorpay' ? 'Secure payment via Razorpay' : 'Test payment'}
                </span>
                <button type="submit" className="btn-primary h-12 bg-[#C8101A] px-6 text-base" disabled={pay.isPending}>
                  {stage === 'verifying' ? 'Confirming your payment…' : stage === 'paying' ? 'Complete the payment in the Razorpay window…' : pay.isPending ? 'Please wait…' : `Proceed to payment, ${formatRupees(order.total)}`}
                </button>
              </div>
            </>
          )}
        </form>
      )}

      <section id="invoices" className="card mt-6 overflow-x-auto" aria-labelledby="inv-h">
        <h2 id="inv-h" className="px-5 pt-4 text-lg font-bold">
          Recent invoices
        </h2>
        {payments.isLoading ? (
          <Spinner />
        ) : !payments.data?.items.length ? (
          <p className="px-5 pb-4 pt-1 text-sm text-muted">No invoices yet.</p>
        ) : (
          <table className="mt-3 w-full min-w-[560px] text-sm">
            <thead className="bg-surface text-left">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Invoice no.</th>
                <th className="px-3 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">Plan</th>
                <th className="px-3 py-2.5 font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.data.items.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-2.5">{p.invoiceNumber}</td>
                  <td className="px-3 py-2.5">{day(p.paidAt)}</td>
                  <td className="px-3 py-2.5">
                    {plans[p.plan as PartnerPlan]?.name ?? p.plan} ({p.cycle === 'monthly' ? 'Monthly' : 'Yearly'})
                  </td>
                  <td className="px-3 py-2.5">{formatRupees(p.amountPaise)}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs font-semibold text-success">{p.test ? 'Paid (test)' : 'Paid'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link to={`/partner/subscription/invoices/${p.id}`} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                      <Download className="size-4" aria-hidden />
                      Download
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const dash = <Minus className="mx-auto size-4 text-muted" aria-label="No" />;
const tick = (b: boolean) => (b ? <Check className="mx-auto size-4 text-success" aria-label="Yes" /> : dash);
const limit = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString('en-IN'));

interface InvoiceView extends Payment {
  company: { name: string; city: string | null; email: string | null };
  paidByName: string;
}

/** A partner's invoice (and the confirmation right after paying), printable or saved as PDF from the browser. */
export function PartnerInvoicePage() {
  const plans = usePartnerPlans();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const justPaid = params.get('paid') === '1';
  const q = useQuery({ queryKey: ['partner', 'subscription', 'invoice', id], queryFn: () => api.get<InvoiceView>(`/partner/subscription/payments/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const p = q.data!;
  const name = plans[p.plan as PartnerPlan]?.name ?? p.plan;
  const base = p.amountPaise - p.gstPaise;
  return (
    <div className="mx-auto max-w-xl">
      {justPaid ? (
        <section className="mb-6 text-center print:hidden">
          <CircleCheck className="mx-auto size-16 text-success" aria-hidden />
          <h1 className="mt-3 text-[28px] font-bold tracking-tight">Payment successful!</h1>
          <p className="text-muted">Your {name} plan is now active.</p>
          {p.test && <p className="mt-2 text-sm text-warning">Test payment: no money was taken.</p>}
        </section>
      ) : (
        <Link to="/partner/subscription" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink print:hidden">
          <ArrowLeft className="size-4" aria-hidden />
          Subscription & Billing
        </Link>
      )}
      <article className="card mt-3 px-6 py-6 print:border-0 print:shadow-none" aria-label={`Invoice ${p.invoiceNumber}`}>
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
              by {p.paidByName}, {METHOD_LABEL[p.method] ?? p.method}
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
                AutoTalent Grid {name} plan (training partner), {p.cycle}
                <span className="block text-muted">
                  {day(p.periodStart)} to {day(p.periodEnd)}
                </span>
              </td>
              <td className="py-3 text-right font-semibold">{formatRupees(base)}</td>
            </tr>
            {p.gstPaise > 0 && (
              <tr className="border-b border-line">
                <td className="py-3">GST</td>
                <td className="py-3 text-right">{formatRupees(p.gstPaise)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 font-semibold">Total</td>
              <td className="pt-3 text-right text-lg font-bold">{formatRupees(p.amountPaise)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-5 text-xs text-muted">The seller&apos;s GSTIN and address are added once AutoTalent Grid confirms them.</p>
        <button type="button" className="btn-secondary mt-5 print:hidden" onClick={() => window.print()}>
          <Download className="size-4" aria-hidden />
          Download or print
        </button>
      </article>
    </div>
  );
}
