import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BENEFICIARY_FIELD_LABEL, PROGRAMME_DOCUMENT_CATEGORIES, PROGRAMME_DOCUMENT_LABEL, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type BeneficiaryField, type Metric } from '@vta/shared';
import { ArrowLeft, Download, FileText, Info, Pencil, Plus, ShieldCheck, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { SearchBox, Select } from '../../components/form';
import { EmptyState, ErrorNote, Field, formatDate, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, qs, uploadFile } from '../../lib/api';
import { useListParams } from '../../lib/useListParams';
import { shortDate } from '../hiring/format';

export interface ProgrammeRow {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  targetCount: number;
  enrolled: number;
  partners: string[];
  batches: number;
}

export interface ProgrammeDetail {
  id: string;
  name: string;
  description: string | null;
  sponsor: { id: string; name: string } | null;
  partners: { id: string; name: string }[];
  batches: { id: string; name: string; status: string; startDate: string; endDate: string; course: string; centre: string }[];
  targetCount: number;
  startDate: string;
  endDate: string;
  status: 'planned' | 'active' | 'closed';
  reportingRequirements: string | null;
  beneficiaryFields: BeneficiaryField[];
  sharingBasis: string | null;
  budget: { reference: string | null; amount: number | null; source: string | null; asOf: string | null } | null;
  canManage: boolean;
  canUpload: boolean;
}

/** PA-02: programmes the partner's organisation is assigned to (VTA staff see all). */
export function ProgrammesPage({ base }: { base: '/partner/programmes' | '/admin/programmes' }) {
  const { values, page, set, setPage } = useListParams(['q', 'status'] as const);
  const q = useQuery({
    queryKey: ['programmes', values, page],
    queryFn: () => api.get<{ items: ProgrammeRow[]; page: number; pageSize: number; total: number }>(`/programmes${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (prev) => prev,
  });
  const admin = base.startsWith('/admin');
  const filtered = !!(values.q || values.status);
  return (
    <>
      <PageHeader
        title="Programmes"
        description={admin ? 'Sponsor and partner programmes, their cohorts and reporting.' : 'Programmes assigned to your organisation.'}
        actions={
          admin && (
            <Link to="/admin/programmes/new" className="btn-primary">
              <Plus className="size-4" aria-hidden />
              New programme
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by programme name" label="Search programmes" />
        <Select
          id="programme-status"
          label="Status"
          value={values.status}
          onChange={(v) => set('status', v)}
          className="sm:w-48"
          options={[
            { value: '', label: 'Any status' },
            { value: 'planned', label: 'Planned' },
            { value: 'active', label: 'Active' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <div className="card">
          {filtered ? (
            <EmptyState title="No programmes match" body="Try another name or status." />
          ) : (
            <EmptyState title="No programmes" body={admin ? 'Create a programme and assign it to a training partner.' : 'VTA assigns programmes to your organisation. They appear here.'} />
          )}
        </div>
      ) : (
        <>
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data!.items.map((p) => (
            <li key={p.id}>
              <Link to={`${base}/${p.id}`} className="card block h-full px-5 py-4 hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {shortDate(p.startDate)} to {shortDate(p.endDate)}. {p.partners.join(', ')}
                </p>
                <p className="mt-3 text-sm">
                  <span className="text-xl font-bold">{p.enrolled}</span> enrolled of a target of {p.targetCount}
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (p.enrolled / p.targetCount) * 100)}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {q.data!.total > q.data!.pageSize && (
          <div className="card mt-4">
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </div>
        )}
        </>
      )}
    </>
  );
}

const BASIS_LABEL: Record<Metric['basis'], string> = { actual: 'Actual', target: 'Target', employer_reported: 'Employer-reported', vta_verified: 'VTA-verified' };
const rate = (m: Metric) => (m.denominator && m.denominator.value ? `${Math.round((m.value / m.denominator.value) * 1000) / 10}%` : null);

/** PA-03: every figure with its definition, type (actual, target, reported, verified) and denominator. */
export function MetricsGrid({ metrics, asOf }: { metrics: Metric[]; asOf: string }) {
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <li key={m.key} className="card px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{m.label}</p>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">{BASIS_LABEL[m.basis]}</span>
            </div>
            <p className="mt-1 text-[28px] font-bold leading-none">
              {m.value.toLocaleString('en-IN')}
              {m.denominator && (
                <span className="ml-1.5 text-sm font-medium text-muted">
                  of {m.denominator.value} {rate(m) ? `(${rate(m)})` : ''}
                </span>
              )}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-muted">{m.definition}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">As of {formatDate(asOf, true)}.</p>
    </>
  );
}

const TABS = ['overview', 'beneficiaries', 'documents'] as const;

/** One programme: dashboard (PA-03), beneficiaries (PA-04), documents (PA-05) and downloads (PA-06). */
export function ProgrammeDetailPage({ base }: { base: '/partner/programmes' | '/admin/programmes' }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]) ?? 'overview';
  const q = useQuery({ queryKey: ['programme', id], queryFn: () => api.get<ProgrammeDetail>(`/programmes/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const p = q.data!;
  return (
    <>
      <Link to={base} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Programmes
      </Link>
      <header className="mb-4 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{p.name}</h1>
          <p className="mt-1 text-muted">
            {shortDate(p.startDate)} to {shortDate(p.endDate)}
            {p.sponsor ? `. Sponsor: ${p.sponsor.name}` : ''}. Partner: {p.partners.map((x) => x.name).join(', ')}
          </p>
          <div className="mt-2">
            <StatusBadge status={p.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/v1/programmes/${id}/report.csv`} className="btn-secondary" download>
            <Download className="size-4" aria-hidden />
            Outcome report (CSV)
          </a>
          {p.canManage && (
            <Link to={`/admin/programmes/${id}/edit`} className="btn-secondary">
              <Pencil className="size-4" aria-hidden />
              Edit
            </Link>
          )}
        </div>
      </header>
      <div role="tablist" aria-label="Programme" className="mb-5 inline-flex rounded-xl bg-surface p-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setParams({ tab: t })} className={`h-9 rounded-lg px-4 text-sm font-semibold capitalize ${tab === t ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'beneficiaries' && <Beneficiaries p={p} />}
      {tab === 'documents' && <Documents p={p} />}
    </>
  );
}

function Overview({ p }: { p: ProgrammeDetail }) {
  const m = useQuery({ queryKey: ['programme', p.id, 'metrics'], queryFn: () => api.get<{ metrics: Metric[]; asOf: string }>(`/programmes/${p.id}/metrics`) });
  return (
    <div className="space-y-6">
      {m.isLoading ? <Spinner /> : m.data ? <MetricsGrid metrics={m.data.metrics} asOf={m.data.asOf} /> : <ErrorNote message="Could not load the figures." />}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 font-semibold">Batches in this programme ({p.batches.length})</h2>
          {!p.batches.length ? (
            <p className="px-5 py-4 text-sm text-muted">No batches linked yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {p.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{b.name}</span>
                    <span className="text-muted">
                      {b.course}, {b.centre}. {shortDate(b.startDate)} to {shortDate(b.endDate)}
                    </span>
                  </span>
                  <StatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card space-y-3 px-5 py-4 text-sm">
          {p.description && <p>{p.description}</p>}
          {p.reportingRequirements && (
            <p>
              <span className="font-semibold">Reporting:</span> {p.reportingRequirements}
            </p>
          )}
          {p.budget && (
            <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Budget reference{p.budget.reference ? `: ${p.budget.reference}` : ''}
                {p.budget.amount != null ? `, ₹${p.budget.amount.toLocaleString('en-IN')}` : ''}. Source: {p.budget.source ?? 'not stated'}
                {p.budget.asOf ? `, as of ${shortDate(p.budget.asOf)}` : ''}. A manually recorded figure, not finance data.
              </span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Beneficiaries({ p }: { p: ProgrammeDetail }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['programme', p.id, 'beneficiaries', page],
    queryFn: () =>
      api.get<{ fields: BeneficiaryField[]; sharingBasis: string | null; items: Record<string, string | number | null>[]; page: number; pageSize: number; total: number }>(`/programmes/${p.id}/beneficiaries${qs({ page })}`),
    placeholderData: (prev) => prev,
  });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorNote message="Could not load beneficiaries." />;
  const { fields, items, sharingBasis } = q.data;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="flex max-w-2xl items-start gap-2 text-sm text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Only the fields VTA approved for this programme are shown.
          {sharingBasis ? ` Basis for sharing personal details: ${sharingBasis}.` : ' Names, mobile numbers and dates of birth are not shared.'}
        </p>
        <a href={`/api/v1/programmes/${p.id}/beneficiaries.csv`} className="btn-secondary btn-sm" download>
          <Download className="size-4" aria-hidden />
          Download (CSV)
        </a>
      </div>
      {!items.length ? (
        <div className="card">
          <EmptyState title="No beneficiaries yet" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Beneficiaries</caption>
            <thead className="border-b border-line text-left text-[13px] text-muted">
              <tr>
                {fields.map((f) => (
                  <th key={f} className="px-4 py-2.5 font-medium">
                    {BENEFICIARY_FIELD_LABEL[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r, i) => (
                <tr key={i}>
                  {fields.map((f) => (
                    <td key={f} className="px-4 py-2.5">
                      {f === 'attendance' ? (r[f] === null ? '—' : `${r[f]}%`) : f === 'enrolmentStatus' ? <StatusBadge status={String(r[f])} /> : (r[f] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {q.data.total > q.data.pageSize && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
        </div>
      )}
    </>
  );
}

function Documents({ p }: { p: ProgrammeDetail }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['programme', p.id, 'documents'], queryFn: () => api.get<{ items: { id: string; title: string; category: keyof typeof PROGRAMME_DOCUMENT_LABEL; sizeBytes: number; uploadedBy: string | null; createdAt: string }[] }>(`/programmes/${p.id}/documents`) });
  const [uploading, setUploading] = useState(false);
  const open = async (docId: string) => {
    const { url } = await api.get<{ url: string }>(`/programmes/${p.id}/documents/${docId}/link`);
    window.open(url, '_blank', 'noopener');
  };
  return (
    <>
      <div className="mb-3 flex justify-end">
        {p.canUpload && (
          <button className="btn-primary" onClick={() => setUploading(true)}>
            <Upload className="size-4" aria-hidden />
            Upload document
          </button>
        )}
      </div>
      {!q.data?.items.length ? (
        <div className="card">
          <EmptyState title="No documents yet" body="Work orders, attendance summaries, reports and supporting evidence for this programme." />
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {q.data.items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <FileText className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{d.title}</span>
                <span className="text-[13px] text-muted">
                  {PROGRAMME_DOCUMENT_LABEL[d.category]}, {formatDate(d.createdAt)}
                  {d.uploadedBy ? `, by ${d.uploadedBy}` : ''}
                </span>
              </span>
              <button className="btn-secondary btn-sm" onClick={() => void open(d.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading && <UploadModal programmeId={p.id} onClose={() => setUploading(false)} onDone={() => qc.invalidateQueries({ queryKey: ['programme', p.id, 'documents'] })} />}
    </>
  );
}

function UploadModal({ programmeId, onClose, onDone }: { programmeId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('report');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!file) e.file = 'Choose a file';
    else if (file.size > UPLOAD_MAX_BYTES) e.file = 'The file is larger than 10 MB';
    if (title.trim().length < 2) e.title = 'Give the document a title';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await uploadFile(`/programmes/${programmeId}/documents${qs({ title: title.trim(), fileName: file!.name, category })}`, file!);
      await onDone();
      toast('success', 'Document uploaded');
      onClose();
    } catch (err) {
      const x = err as { fields?: Record<string, string>; message: string };
      setErrors({ ...(x.fields ?? {}), _: x.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Upload programme document"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ && <ErrorNote message={errors._} />}
        <Field label="File" htmlFor="pd-file" error={errors.file} hint={`${Object.values(UPLOAD_TYPES).join(', ')}, up to 10 MB.`}>
          <input
            id="pd-file"
            type="file"
            accept={Object.keys(UPLOAD_TYPES).join(',')}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-tint file:px-4 file:py-2.5 file:font-semibold file:text-brand"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </Field>
        <Field label="Type" htmlFor="pd-cat">
          <select id="pd-cat" className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {PROGRAMME_DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PROGRAMME_DOCUMENT_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="pd-title" error={errors.title}>
          <input id="pd-title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
