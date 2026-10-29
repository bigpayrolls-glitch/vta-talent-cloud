import { useQuery, useQueryClient } from '@tanstack/react-query';
import { employerPlanEditSchema, formatRupees, PLANS, type Plan, type PlanInfo, type PlanTable } from '@vta/shared';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, Modal, PageHeader, Spinner, formatDate } from '../../components/ui';
import { api } from '../../lib/api';
import { useForm } from '../../lib/useForm';

/** Admin > Plans: names, prices, limits and feature lines of the employer plans. Changes apply within a minute. */
export function PlansAdminPage() {
  const q = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<{ employer: PlanTable; changed: { audience: string; code: string; at: string; by: string | null }[] }>('/admin/plans') });
  const [editing, setEditing] = useState<Plan | null>(null);
  return (
    <div>
      <PageHeader title="Plans" description="What each plan costs and includes. Changes show on the plans pages and apply to limits within a minute. Plans already paid for keep their end date." />
      <h2 className="mb-3 font-semibold">Employer plans</h2>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((code) => {
            const p = q.data!.employer[code];
            const changed = q.data!.changed.find((c) => c.audience === 'employer' && c.code === code);
            return (
              <li key={code} className="card flex flex-col px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="text-sm text-muted">{p.tagline}</p>
                  </div>
                  <button className="btn-secondary btn-sm" onClick={() => setEditing(code)} aria-label={`Edit ${p.name}`}>
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </button>
                </div>
                <p className="mt-3 text-xl font-extrabold">
                  {p.price ? (
                    <>
                      {formatRupees(p.price.monthly)}
                      <span className="text-sm font-medium text-muted"> / month, {formatRupees(p.price.yearly)} / year</span>
                    </>
                  ) : (
                    <span className="text-base">As agreed{p.fromPrice ? `, from ${formatRupees(p.fromPrice)}` : ''}</span>
                  )}
                </p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Active jobs</dt>
                  <dd>{limitText(p.activeJobs)}</dd>
                  <dt className="text-muted">Applicants</dt>
                  <dd>{p.applicants ? `${p.applicants.limit} per ${p.applicants.per}` : 'No limit'}</dd>
                  <dt className="text-muted">Search results</dt>
                  <dd>{p.search.results === null ? 'All' : `First ${p.search.results}`}</dd>
                  <dt className="text-muted">Profile views</dt>
                  <dd>{limitText(p.search.profileViews, ' a month')}</dd>
                  <dt className="text-muted">Invites</dt>
                  <dd>{limitText(p.search.invites, ' a month')}</dd>
                  <dt className="text-muted">All filters</dt>
                  <dd>{yesNo(p.search.allFilters)}</dd>
                  <dt className="text-muted">Contact details</dt>
                  <dd>{yesNo(p.contactDetails)}</dd>
                  <dt className="text-muted">Interviews</dt>
                  <dd>{yesNo(p.interviews)}</dd>
                </dl>
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-ink/80">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {changed && <p className="mt-auto pt-3 text-xs text-muted">Changed {formatDate(changed.at, true)}{changed.by ? ` by ${changed.by}` : ''}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {editing && q.data && <EditPlanModal code={editing} plan={q.data.employer[editing]} onClose={() => setEditing(null)} />}
    </div>
  );
}

const limitText = (n: number | null, suffix = '') => (n === null ? 'No limit' : `${n}${suffix}`);
const yesNo = (b: boolean) =>
  b ? (
    <span className="inline-flex items-center gap-1 text-success">
      <Check className="size-4" aria-hidden /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted">
      <X className="size-4" aria-hidden /> No
    </span>
  );

const rupeesOf = (paise: number | undefined) => (paise === undefined ? '' : String(Math.round(paise / 100)));
const numOrNull = (s: string) => (s.trim() === '' ? null : s.trim());

function EditPlanModal({ code, plan, onClose }: { code: Plan; plan: PlanInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(employerPlanEditSchema);
  const [v, setV] = useState({
    name: plan.name,
    tagline: plan.tagline,
    monthly: rupeesOf(plan.price?.monthly),
    yearly: rupeesOf(plan.price?.yearly),
    fromPrice: rupeesOf(plan.fromPrice),
    activeJobs: plan.activeJobs === null ? '' : String(plan.activeJobs),
    applicantsLimit: plan.applicants ? String(plan.applicants.limit) : '',
    applicantsPer: plan.applicants?.per ?? 'month',
    results: plan.search.results === null ? '' : String(plan.search.results),
    profileViews: plan.search.profileViews === null ? '' : String(plan.search.profileViews),
    invites: plan.search.invites === null ? '' : String(plan.search.invites),
    allFilters: plan.search.allFilters,
    contactDetails: plan.contactDetails,
    interviews: plan.interviews,
    features: plan.features.join('\n'),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const tick = (k: 'allFilters' | 'contactDetails' | 'interviews') => (e: { target: { checked: boolean } }) => setV({ ...v, [k]: e.target.checked });
  const agreed = code === 'enterprise';
  const save = () =>
    f.submit(
      {
        name: v.name,
        tagline: v.tagline,
        price: agreed ? null : { monthly: v.monthly || '0', yearly: v.yearly || '0' },
        ...(agreed && v.fromPrice ? { fromPrice: v.fromPrice } : {}),
        activeJobs: numOrNull(v.activeJobs),
        applicants: v.applicantsLimit.trim() === '' ? null : { limit: v.applicantsLimit, per: v.applicantsPer },
        contactDetails: v.contactDetails,
        interviews: v.interviews,
        search: { results: numOrNull(v.results), profileViews: numOrNull(v.profileViews), invites: numOrNull(v.invites), allFilters: v.allFilters },
        features: v.features
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      },
      async (data) => {
        await api.put(`/admin/plans/employer/${code}`, data);
        await qc.invalidateQueries({ queryKey: ['admin', 'plans'] });
        await qc.invalidateQueries({ queryKey: ['plans'] });
        toast('success', `${v.name} plan saved`);
        onClose();
      },
    );
  const e = f.errors;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Edit ${plan.name} plan`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={f.submitting}>
            {f.submitting ? 'Saving…' : 'Save plan'}
          </button>
        </>
      }
    >
      <div className="max-h-[65dvh] space-y-4 overflow-y-auto pr-1">
        {f.formError && <ErrorNote message={f.formError} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="pl-name" error={e.name}>
            <input id="pl-name" className="field-input" value={v.name} onChange={set('name')} />
          </Field>
          <Field label="Short description" htmlFor="pl-tag" error={e.tagline}>
            <input id="pl-tag" className="field-input" value={v.tagline} onChange={set('tagline')} />
          </Field>
        </div>
        {agreed ? (
          <Field label="Starting price shown (₹ a month, optional)" htmlFor="pl-from" error={e.fromPrice} hint="Enterprise is priced with each customer. This is only shown on the plans page.">
            <input id="pl-from" type="number" min={0} className="field-input sm:max-w-[240px]" value={v.fromPrice} onChange={set('fromPrice')} />
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly price (₹)" htmlFor="pl-month" error={e['price.monthly'] ?? e.price}>
              <input id="pl-month" type="number" min={0} className="field-input" value={v.monthly} onChange={set('monthly')} disabled={code === 'free'} />
            </Field>
            <Field label="Yearly price (₹)" htmlFor="pl-year" error={e['price.yearly']}>
              <input id="pl-year" type="number" min={0} className="field-input" value={v.yearly} onChange={set('yearly')} disabled={code === 'free'} />
            </Field>
          </div>
        )}
        <fieldset className="space-y-3 rounded-xl border border-line px-4 py-3">
          <legend className="px-1 text-sm font-semibold">Limits (leave empty for no limit)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Active jobs at a time" htmlFor="pl-jobs" error={e.activeJobs}>
              <input id="pl-jobs" type="number" min={0} className="field-input" value={v.activeJobs} onChange={set('activeJobs')} />
            </Field>
            <Field label="Applicants that can be opened" htmlFor="pl-app" error={e['applicants.limit']}>
              <input id="pl-app" type="number" min={0} className="field-input" value={v.applicantsLimit} onChange={set('applicantsLimit')} />
            </Field>
            <Field label="Counted" htmlFor="pl-per">
              <select id="pl-per" className="field-input" value={v.applicantsPer} onChange={set('applicantsPer')}>
                <option value="job">Per job</option>
                <option value="month">Per month</option>
              </select>
            </Field>
            <Field label="Search results shown" htmlFor="pl-res" error={e['search.results']}>
              <input id="pl-res" type="number" min={0} className="field-input" value={v.results} onChange={set('results')} />
            </Field>
            <Field label="Profile views a month" htmlFor="pl-views" error={e['search.profileViews']}>
              <input id="pl-views" type="number" min={0} className="field-input" value={v.profileViews} onChange={set('profileViews')} />
            </Field>
            <Field label="Invites a month" htmlFor="pl-inv" error={e['search.invites']}>
              <input id="pl-inv" type="number" min={0} className="field-input" value={v.invites} onChange={set('invites')} />
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-xl border border-line px-4 py-3 text-sm">
          <legend className="px-1 font-semibold">Included</legend>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.contactDetails} onChange={tick('contactDetails')} /> Candidate contact details
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.interviews} onChange={tick('interviews')} /> Interview management
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.allFilters} onChange={tick('allFilters')} /> Experience and certificate search filters
          </label>
        </fieldset>
        <Field label="Feature lines on the plans page (one per line)" htmlFor="pl-feat" error={e.features}>
          <textarea id="pl-feat" rows={6} className="field-input h-auto py-2" value={v.features} onChange={set('features')} />
        </Field>
      </div>
    </Modal>
  );
}
