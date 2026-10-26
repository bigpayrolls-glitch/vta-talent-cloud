import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BENEFICIARY_FIELD_LABEL, BENEFICIARY_FIELDS, DEFAULT_BENEFICIARY_FIELDS, PROGRAMME_STATUSES, programmeSchema, SENSITIVE_BENEFICIARY_FIELDS, type BeneficiaryField, type Page } from '@vta/shared';
import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useForm } from '../../lib/useForm';
import { shortDate } from '../hiring/format';
import type { ProgrammeDetail } from './Programmes';

interface Org {
  id: string;
  legalName: string;
  partnerSubtype: string | null;
  verificationStatus: string;
}
interface BatchRow {
  id: string;
  name: string;
  status: string;
  startDate: string;
  centre: { name: string };
}

/** AD-10: create or edit a programme (VTA staff). */
export function ProgrammeFormPage() {
  const { id } = useParams();
  const existing = useQuery({ queryKey: ['programme', id], enabled: !!id, queryFn: () => api.get<ProgrammeDetail>(`/programmes/${id}`) });
  const orgs = useQuery({ queryKey: ['organisations', 'partner', 'all'], queryFn: () => api.get<Page<Org>>('/admin/organisations?type=partner&pageSize=100') });
  const batches = useQuery({ queryKey: ['batches', 'all-for-programmes'], queryFn: () => api.get<Page<BatchRow>>('/batches?pageSize=100') });
  if ((id && existing.isLoading) || orgs.isLoading || batches.isLoading) return <Spinner />;
  if (existing.isError || orgs.isError || batches.isError) return <ErrorNote message="Could not load the form." />;
  return <Form id={id} p={existing.data} orgs={orgs.data!.items} batches={batches.data!.items} />;
}

function Form({ id, p, orgs, batches }: { id?: string; p?: ProgrammeDetail; orgs: Org[]; batches: BatchRow[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(programmeSchema);
  const [v, setV] = useState({
    name: p?.name ?? '',
    description: p?.description ?? '',
    sponsorOrganisationId: p?.sponsor?.id ?? '',
    partnerOrganisationIds: p?.partners.map((x) => x.id) ?? [],
    batchIds: p?.batches.map((b) => b.id) ?? [],
    targetCount: String(p?.targetCount ?? ''),
    startDate: p?.startDate ?? '',
    endDate: p?.endDate ?? '',
    status: p?.status ?? 'planned',
    reportingRequirements: p?.reportingRequirements ?? '',
    beneficiaryFields: (p?.beneficiaryFields ?? DEFAULT_BENEFICIARY_FIELDS) as BeneficiaryField[],
    sharingBasis: p?.sharingBasis ?? '',
    budgetReference: p?.budget?.reference ?? '',
    budgetAmount: p?.budget?.amount != null ? String(p.budget.amount) : '',
    budgetSource: p?.budget?.source ?? '',
    budgetAsOf: p?.budget?.asOf ?? '',
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const toggle = <K extends 'partnerOrganisationIds' | 'batchIds' | 'beneficiaryFields'>(k: K, x: string) =>
    setV({ ...v, [k]: (v[k] as string[]).includes(x) ? (v[k] as string[]).filter((y) => y !== x) : [...(v[k] as string[]), x] });
  const sensitive = v.beneficiaryFields.some((x) => SENSITIVE_BENEFICIARY_FIELDS.includes(x));

  return (
    <>
      <Link to={id ? `/admin/programmes/${id}` : '/admin/programmes'} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {id ? 'Back to the programme' : 'Programmes'}
      </Link>
      <h1 className="mb-5 mt-3 text-[26px] font-bold tracking-tight">{id ? 'Edit programme' : 'New programme'}</h1>
      <form
        noValidate
        className="card max-w-3xl space-y-5 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(
            { ...v, sponsorOrganisationId: v.sponsorOrganisationId || null, budgetAmount: v.budgetAmount === '' ? null : v.budgetAmount, budgetAsOf: v.budgetAsOf || null },
            async (data) => {
              const res = id ? await api.put<{ id: string }>(`/admin/programmes/${id}`, data) : await api.post<{ id: string }>('/admin/programmes', data);
              await qc.invalidateQueries({ queryKey: ['programmes'] });
              await qc.invalidateQueries({ queryKey: ['programme'] });
              toast('success', id ? 'Programme saved' : 'Programme created');
              navigate(`/admin/programmes/${res.id ?? id}`);
            },
          );
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Programme name" htmlFor="pg-name" error={f.errors.name}>
          <input id="pg-name" className="field-input" value={v.name} onChange={set('name')} />
        </Field>
        <Field label="Description (optional)" htmlFor="pg-desc" error={f.errors.description}>
          <textarea id="pg-desc" rows={2} className="field-input h-auto py-2" value={v.description} onChange={set('description')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Target people" htmlFor="pg-target" error={f.errors.targetCount}>
            <input id="pg-target" type="number" min={1} className="field-input" value={v.targetCount} onChange={set('targetCount')} />
          </Field>
          <Field label="Start" htmlFor="pg-start" error={f.errors.startDate}>
            <input id="pg-start" type="date" className="field-input" value={v.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="End" htmlFor="pg-end" error={f.errors.endDate}>
            <input id="pg-end" type="date" className="field-input" value={v.endDate} onChange={set('endDate')} />
          </Field>
          <Field label="Status" htmlFor="pg-status">
            <select id="pg-status" className="field-input" value={v.status} onChange={set('status')}>
              {PROGRAMME_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset>
          <legend className="field-label">Training partners who can see this programme</legend>
          <div className="flex flex-wrap gap-2">
            {orgs
              .filter((o) => o.partnerSubtype !== 'csr_sponsor')
              .map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.partnerOrganisationIds.includes(o.id)} onChange={() => toggle('partnerOrganisationIds', o.id)} />
                  {o.legalName}
                </label>
              ))}
          </div>
          {f.errors.partnerOrganisationIds && <p className="field-error">{f.errors.partnerOrganisationIds}</p>}
        </fieldset>
        <Field label="Sponsor (optional)" htmlFor="pg-sponsor" error={f.errors.sponsorOrganisationId}>
          <select id="pg-sponsor" className="field-input" value={v.sponsorOrganisationId} onChange={set('sponsorOrganisationId')}>
            <option value="">None</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.legalName}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend className="field-label">Batches in the cohort</legend>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {batches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface">
                <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.batchIds.includes(b.id)} onChange={() => toggle('batchIds', b.id)} />
                <span className="flex-1">
                  {b.name} <span className="text-muted">({b.centre.name}, starts {shortDate(b.startDate)}, {b.status})</span>
                </span>
              </label>
            ))}
          </div>
          {f.errors.batchIds && <p className="field-error">{f.errors.batchIds}</p>}
        </fieldset>

        <fieldset>
          <legend className="field-label">Beneficiary fields the partner may see</legend>
          <div className="flex flex-wrap gap-2">
            {BENEFICIARY_FIELDS.map((x) => (
              <label key={x} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${SENSITIVE_BENEFICIARY_FIELDS.includes(x) ? 'border-warning' : 'border-line'}`}>
                <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={v.beneficiaryFields.includes(x)} onChange={() => toggle('beneficiaryFields', x)} />
                {BENEFICIARY_FIELD_LABEL[x]}
                {SENSITIVE_BENEFICIARY_FIELDS.includes(x) && <Lock className="size-3.5 text-warning" aria-label="personal" />}
              </label>
            ))}
          </div>
        </fieldset>
        {sensitive && (
          <Field label="Basis for sharing personal details" htmlFor="pg-basis" error={f.errors.sharingBasis} hint="For example: consent forms collected, or the clause of the programme agreement.">
            <input id="pg-basis" className="field-input" value={v.sharingBasis} onChange={set('sharingBasis')} />
          </Field>
        )}
        <Field label="Reporting requirements (optional)" htmlFor="pg-rep" error={f.errors.reportingRequirements}>
          <textarea id="pg-rep" rows={2} className="field-input h-auto py-2" value={v.reportingRequirements} onChange={set('reportingRequirements')} />
        </Field>
        <fieldset className="rounded-xl bg-surface/60 px-4 py-3">
          <legend className="px-1 text-sm font-semibold">Budget reference (optional)</legend>
          <p className="mb-3 text-[13px] text-muted">Recorded by hand with its source and date. It is shown as a reference, never as finance data.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reference" htmlFor="pg-bref" error={f.errors.budgetReference}>
              <input id="pg-bref" className="field-input" value={v.budgetReference} onChange={set('budgetReference')} />
            </Field>
            <Field label="Amount (₹)" htmlFor="pg-bamt" error={f.errors.budgetAmount}>
              <input id="pg-bamt" type="number" min={0} className="field-input" value={v.budgetAmount} onChange={set('budgetAmount')} />
            </Field>
            <Field label="Source" htmlFor="pg-bsrc" error={f.errors.budgetSource}>
              <input id="pg-bsrc" className="field-input" value={v.budgetSource} onChange={set('budgetSource')} />
            </Field>
            <Field label="As of" htmlFor="pg-basof" error={f.errors.budgetAsOf}>
              <input id="pg-basof" type="date" className="field-input" value={v.budgetAsOf} onChange={set('budgetAsOf')} />
            </Field>
          </div>
        </fieldset>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={f.submitting}>
            {f.submitting ? 'Saving…' : id ? 'Save programme' : 'Create programme'}
          </button>
          <Link to={id ? `/admin/programmes/${id}` : '/admin/programmes'} className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
