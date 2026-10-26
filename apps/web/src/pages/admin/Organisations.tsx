import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminSetPlanSchema, createOrganisationSchema, formatRupees, PARTNER_SUBTYPES, PLAN_INFO, PLANS, reasonSchema, type Page, type Plan, type SubscriptionDto } from '@vta/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNote, Field, formatDate, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../components/toast';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { CompanyVerificationDetails } from './Hiring';

interface OrgRow {
  id: string;
  type: 'employer' | 'partner';
  partnerSubtype: string | null;
  legalName: string;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  verificationStatus: string;
  verificationReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  registrationSource: 'vta' | 'self';
  awaitingEmail: boolean;
  possibleDuplicate: boolean;
  submittedAt: string | null;
}

const SUBTYPE_LABEL: Record<string, string> = {
  oem: 'OEM',
  csr_sponsor: 'CSR sponsor',
  ngo: 'NGO',
  college: 'College',
  training_provider: 'Training provider',
  automotive_company: 'Automotive or lubricant company',
  other: 'Other',
};

const TABS = [
  { key: '', label: 'All' },
  { key: 'employer', label: 'Employers' },
  { key: 'partner', label: 'Training partners' },
];

export function OrganisationsPage() {
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<OrgRow | null>(null);
  const type = params.get('type') ?? '';
  const verificationStatus = params.get('verificationStatus') ?? '';
  const page = Number(params.get('page') ?? 1);

  const q = useQuery({
    queryKey: ['organisations', type, verificationStatus, page],
    queryFn: () => api.get<Page<OrgRow>>(`/admin/organisations${qs({ type, verificationStatus, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };

  return (
    <div>
      <PageHeader
        title="Organisations"
        description="Employers and training partners. Verify them before they can post jobs or run programmes."
        actions={
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add organisation
          </button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Organisation type" className="inline-flex rounded-xl bg-surface p-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={type === t.key} onClick={() => set('type', t.key)} className={`h-9 rounded-lg px-4 text-sm font-semibold ${type === t.key ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="vs">
          Verification status
        </label>
        <select id="vs" className="field-input sm:w-56" value={verificationStatus} onChange={(e) => set('verificationStatus', e.target.value)}>
          <option value="">Any verification status</option>
          <option value="pending">Pending</option>
          <option value="more_info_needed">More info needed</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No organisations here yet" body="Add an employer or training partner to get started." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((o) => (
                <li key={o.id}>
                  <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-left hover:bg-surface/60" onClick={() => setSelected(o)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{o.legalName}</span>
                      <span className="block text-sm text-muted">
                        {o.type === 'employer' ? 'Employer' : `Training partner, ${SUBTYPE_LABEL[o.partnerSubtype ?? 'other']}`}. {o.registrationSource === 'self' ? 'Registered themselves' : 'Added'} {formatDate(o.createdAt)}
                      </span>
                      {(o.awaitingEmail || o.possibleDuplicate || (o.registrationSource === 'self' && !o.submittedAt && o.verificationStatus === 'pending')) && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {o.awaitingEmail ? (
                            <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-muted">Email not confirmed</span>
                          ) : (
                            o.registrationSource === 'self' && !o.submittedAt && o.verificationStatus === 'pending' && <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-muted">Profile not sent yet</span>
                          )}
                          {o.possibleDuplicate && <span className="rounded-md bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning">Possible duplicate</span>}
                        </span>
                      )}
                    </span>
                    <StatusBadge status={o.verificationStatus} />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
          </>
        )}
      </div>

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {selected && <OrgModal org={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(createOrganisationSchema);
  const blank = { type: 'employer', partnerSubtype: '', legalName: '', address: '', contactName: '', contactEmail: '', contactPhone: '' };
  const [v, setV] = useState(blank);
  const upd = (k: keyof typeof blank) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const close = () => {
    setV(blank);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add organisation"
      footer={
        <>
          <button className="btn-secondary" onClick={close}>Cancel</button>
          <button className="btn-primary" type="submit" form="org-form" disabled={f.submitting}>Add organisation</button>
        </>
      }
    >
      <form
        id="org-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
          void f.submit(body, async (data) => {
            await api.post('/admin/organisations', data);
            await qc.invalidateQueries({ queryKey: ['organisations'] });
            await qc.invalidateQueries({ queryKey: ['dashboard'] });
            toast('success', 'Organisation added. It stays pending until you verify it.');
            close();
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Type" htmlFor="o-type">
          <select id="o-type" className="field-input" value={v.type} onChange={upd('type')}>
            <option value="employer">Employer</option>
            <option value="partner">Training partner</option>
          </select>
        </Field>
        {v.type === 'partner' && (
          <Field label="Partner type" htmlFor="o-sub" error={f.errors.partnerSubtype}>
            <select id="o-sub" className="field-input" value={v.partnerSubtype} onChange={upd('partnerSubtype')}>
              <option value="">Choose a type</option>
              {PARTNER_SUBTYPES.map((s) => <option key={s} value={s}>{SUBTYPE_LABEL[s]}</option>)}
            </select>
          </Field>
        )}
        <Field label="Legal or business name" htmlFor="o-name" error={f.errors.legalName}>
          <input id="o-name" autoFocus className="field-input" value={v.legalName} onChange={upd('legalName')} />
        </Field>
        <Field label="Address" htmlFor="o-addr" error={f.errors.address}>
          <input id="o-addr" className="field-input" value={v.address} onChange={upd('address')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person" htmlFor="o-cn" error={f.errors.contactName}>
            <input id="o-cn" className="field-input" value={v.contactName} onChange={upd('contactName')} />
          </Field>
          <Field label="Contact mobile" htmlFor="o-cp" error={f.errors.contactPhone}>
            <input id="o-cp" type="tel" className="field-input" value={v.contactPhone} onChange={upd('contactPhone')} />
          </Field>
        </div>
        <Field label="Contact email" htmlFor="o-ce" error={f.errors.contactEmail}>
          <input id="o-ce" type="email" className="field-input" value={v.contactEmail} onChange={upd('contactEmail')} />
        </Field>
      </form>
    </Modal>
  );
}

function OrgModal({ org, onClose }: { org: OrgRow; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<'reject' | 'request-info' | null>(null);
  const [reason, setReason] = useState('');
  const f = useForm(reasonSchema);
  const [error, setError] = useState('');

  const decide = async (path: 'verify' | 'reject' | 'request-info', body: object = {}) => {
    await api.post(`/admin/organisations/${org.id}/${path}`, body);
    await qc.invalidateQueries({ queryKey: ['organisations'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('success', path === 'verify' ? 'Organisation verified' : path === 'reject' ? 'Organisation rejected' : 'More information requested');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={org.legalName}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Type</dt>
        <dd>{org.type === 'employer' ? 'Employer' : `Training partner (${SUBTYPE_LABEL[org.partnerSubtype ?? 'other']})`}</dd>
        <dt className="text-muted">Status</dt>
        <dd><StatusBadge status={org.verificationStatus} /></dd>
        {org.verificationReason && (<><dt className="text-muted">Reason</dt><dd>{org.verificationReason}</dd></>)}
        <dt className="text-muted">Address</dt>
        <dd>{org.address ?? '—'}</dd>
        <dt className="text-muted">Contact</dt>
        <dd>{[org.contactName, org.contactPhone, org.contactEmail].filter(Boolean).join(', ') || '—'}</dd>
        <dt className="text-muted">Verified</dt>
        <dd>{formatDate(org.verifiedAt)}</dd>
      </dl>
      <CompanyVerificationDetails orgId={org.id} />
      {org.type === 'employer' && can('subscription.manage') && <EmployerPlanPanel orgId={org.id} />}

      {can('organisation.verify') && !decision && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
          {org.verificationStatus !== 'verified' && (
            <button className="btn-primary" onClick={() => void decide('verify').catch((e) => setError(e.message))}>Verify</button>
          )}
          {org.verificationStatus !== 'more_info_needed' && <button className="btn-secondary" onClick={() => setDecision('request-info')}>Ask for more information</button>}
          {org.verificationStatus !== 'rejected' && <button className="btn-secondary text-brand" onClick={() => setDecision('reject')}>Reject</button>}
        </div>
      )}
      {error && <div className="mt-4"><ErrorNote message={error} /></div>}

      {decision && (
        <form
          noValidate
          className="mt-6 space-y-4 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit({ reason }, (data) => decide(decision, data));
          }}
        >
          {f.formError && <ErrorNote message={f.formError} />}
          <Field
            label={decision === 'reject' ? 'Why is it rejected?' : 'What information is needed?'}
            htmlFor="org-reason"
            error={f.errors.reason}
            hint="Saved with the organisation and in the audit log."
          >
            <textarea id="org-reason" rows={3} className="field-input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDecision(null)}>Back</button>
            <button type="submit" className="btn-primary" disabled={f.submitting}>{decision === 'reject' ? 'Reject' : 'Send request'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Phase 12: the employer's plan; AutoTalent Grid can set one by hand (Enterprise, or paid outside the platform). */
function EmployerPlanPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['organisations', orgId, 'subscription'],
    queryFn: () => api.get<SubscriptionDto & { payments: { id: string; invoiceNumber: string; plan: Plan; amountPaise: number; paidAt: string; test: boolean }[] }>(`/admin/organisations/${orgId}/subscription`),
  });
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<Plan>('enterprise');
  const [months, setMonths] = useState('12');
  const [reason, setReason] = useState('');
  const f = useForm(adminSetPlanSchema);
  if (!q.data) return null;
  const s = q.data;
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby={`plan-${orgId}`}>
      <h3 id={`plan-${orgId}`} className="font-semibold">
        Plan
      </h3>
      <p className="mt-1 text-sm">
        <span className="font-semibold">{PLAN_INFO[s.plan].name}</span>
        {s.plan !== 'free' && s.periodEnd ? `, until ${formatDate(s.periodEnd)}` : ''}
        {s.source ? ` (${s.source === 'payment' ? 'paid online' : 'set by AutoTalent Grid'})` : ''}. Active jobs {s.usage.activeJobs}
        {s.usage.activeJobsLimit !== null ? ` of ${s.usage.activeJobsLimit}` : ''}.
      </p>
      {s.payments.length > 0 && (
        <ul className="mt-2 text-sm text-muted">
          {s.payments.slice(0, 3).map((p) => (
            <li key={p.id}>
              {p.invoiceNumber}: {PLAN_INFO[p.plan].name}, {formatRupees(p.amountPaise)}, {formatDate(p.paidAt)}
              {p.test ? ' (test)' : ''}
            </li>
          ))}
        </ul>
      )}
      {!editing ? (
        <button type="button" className="btn-secondary mt-3" onClick={() => setEditing(true)}>
          Set plan
        </button>
      ) : (
        <form
          noValidate
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit({ plan, months: plan === 'free' ? undefined : months, reason }, async (data) => {
              await api.post(`/admin/organisations/${orgId}/subscription`, data);
              await qc.invalidateQueries({ queryKey: ['organisations', orgId, 'subscription'] });
              toast('success', 'Plan set');
              setEditing(false);
            });
          }}
        >
          {f.formError && <ErrorNote message={f.formError} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan" htmlFor={`plan-sel-${orgId}`}>
              <select id={`plan-sel-${orgId}`} className="field-input" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_INFO[p].name}
                  </option>
                ))}
              </select>
            </Field>
            {plan !== 'free' && (
              <Field label="Months" htmlFor={`plan-months-${orgId}`} error={f.errors.months}>
                <input id={`plan-months-${orgId}`} type="number" min={1} max={36} className="field-input" value={months} onChange={(e) => setMonths(e.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Reason" htmlFor={`plan-reason-${orgId}`} error={f.errors.reason} hint="For example, the signed agreement or the bank transfer reference. Saved in the audit log.">
            <input id={`plan-reason-${orgId}`} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={f.submitting}>
              Save plan
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
