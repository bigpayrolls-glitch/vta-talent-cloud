import { useQuery, useQueryClient } from '@tanstack/react-query';
import { partnerProfileSchema, PARTNER_SUBTYPES, type Metric, type Page } from '@vta/shared';
import { Download, FileText, Lock, Send, Upload } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, formatDate, Modal, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { MetricsGrid } from './Programmes';

interface Report {
  asOf: string;
  cohort: string;
  batches: number;
  filters: Record<string, string | null>;
  metrics: Metric[];
}

/** AD-11: cohort figures for VTA, filtered by date, course, centre, partner and programme, with a CSV download. */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const f = { from: params.get('from') ?? '', to: params.get('to') ?? '', courseId: params.get('courseId') ?? '', centreId: params.get('centreId') ?? '', partnerId: params.get('partnerId') ?? '', programmeId: params.get('programmeId') ?? '' };
  const report = useQuery({ queryKey: ['report', f], queryFn: () => api.get<Report>(`/admin/reports/cohort${qs(f)}`), placeholderData: (p) => p });
  const courses = useQuery({ queryKey: ['courses', 'all'], queryFn: () => api.get<Page<{ id: string; title: string }>>('/courses?pageSize=100') });
  const centres = useQuery({ queryKey: ['centres', 'all'], queryFn: () => api.get<Page<{ id: string; name: string }>>('/centres?pageSize=100') });
  const partners = useQuery({ queryKey: ['organisations', 'partner', 'all'], queryFn: () => api.get<Page<{ id: string; legalName: string }>>('/admin/organisations?type=partner&pageSize=100') });
  const programmes = useQuery({ queryKey: ['programmes'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/programmes') });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const select = (k: keyof typeof f, label: string, items: { id: string; name: string }[] | undefined) => (
    <div>
      <label className="field-label" htmlFor={`r-${k}`}>
        {label}
      </label>
      <select id={`r-${k}`} className="field-input" value={f[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">All</option>
        {items?.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Cohort figures with their definitions. Downloads contain no personal data and are logged."
        actions={
          <a href={`/api/v1/admin/reports/cohort.csv${qs(f)}`} className="btn-primary" download>
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
        }
      />
      <div className="card mb-5 grid gap-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="field-label" htmlFor="r-from">
            Batches starting from
          </label>
          <input id="r-from" type="date" className="field-input" value={f.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="r-to">
            to
          </label>
          <input id="r-to" type="date" className="field-input" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        {select('courseId', 'Course', courses.data?.items.map((c) => ({ id: c.id, name: c.title })))}
        {select('centreId', 'Centre', centres.data?.items)}
        {select('partnerId', 'Partner', partners.data?.items.map((p) => ({ id: p.id, name: p.legalName })))}
        {select('programmeId', 'Programme', programmes.data?.items)}
      </div>
      {report.isLoading ? (
        <Spinner />
      ) : report.isError ? (
        <ErrorNote message={(report.error as Error).message} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{report.data!.cohort}</p>
          <MetricsGrid metrics={report.data!.metrics} asOf={report.data!.asOf} />
        </>
      )}
    </>
  );
}

interface PartnerOrg {
  id: string;
  legalName: string;
  partnerSubtype: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  registrationNumber: string | null;
  programmeInterests: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'more_info_needed';
  verificationReason: string | null;
  submittedAt: string | null;
  identityLocked: boolean;
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

/** PA-01: the partner's organisation profile, registration documents and verification status. */
export function PartnerOrganisationPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['partner', 'organisation'], queryFn: () => api.get<PartnerOrg>('/partner/organisation') });
  const docs = useQuery({ queryKey: ['partner', 'organisation', 'documents'], queryFn: () => api.get<{ items: { id: string; title: string; createdAt: string }[] }>('/partner/organisation/documents') });
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const o = q.data!;
  const isAdmin = can('partner.profile');
  const open = async (id: string) => {
    const { url } = await api.get<{ url: string }>(`/partner/organisation/documents/${id}/link`);
    window.open(url, '_blank', 'noopener');
  };
  return (
    <>
      <PageHeader title="Organisation" description="Your organisation's profile and registration documents, checked by VTA." />
      <section className="card mb-6 flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">Verification</p>
          <div className="mt-1">
            <StatusBadge status={o.verificationStatus} label={o.verificationStatus === 'verified' ? 'Verified by VTA' : undefined} />
          </div>
          {o.verificationReason && <p className="mt-2 text-sm">VTA&apos;s note: {o.verificationReason}</p>}
        </div>
        {isAdmin && (o.verificationStatus === 'pending' || o.verificationStatus === 'more_info_needed') && (
          <button
            className="btn-primary"
            onClick={async () => {
              setSubmitError('');
              try {
                await api.post('/partner/organisation/submit');
                await qc.invalidateQueries({ queryKey: ['partner'] });
                toast('success', 'Sent to VTA for checking');
              } catch (e) {
                setSubmitError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Could not send');
              }
            }}
          >
            <Send className="size-4" aria-hidden />
            Send to VTA
          </button>
        )}
        {submitError && (
          <div className="w-full">
            <ErrorNote message={submitError} />
          </div>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {isAdmin ? (
          <PartnerForm o={o} />
        ) : (
          <dl className="card divide-y divide-line text-sm">
            {(
              [
                ['Registered name', o.legalName],
                ['Type', o.partnerSubtype ? SUBTYPE_LABEL[o.partnerSubtype] : null],
                ['City', o.city],
                ['Programme interests', o.programmeInterests],
                ['Contact', [o.contactName, o.contactPhone, o.contactEmail].filter(Boolean).join(', ')],
              ] as const
            ).map(([k, val]) => (
              <div key={k} className="grid gap-0.5 px-5 py-2.5 sm:grid-cols-[180px_1fr]">
                <dt className="text-muted">{k}</dt>
                <dd>{val || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        <aside className="card h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Registration documents</h2>
            {isAdmin && (
              <button className="btn-quiet btn-sm" onClick={() => setUploading(true)}>
                <Upload className="size-4" aria-hidden />
                Upload
              </button>
            )}
          </div>
          {!docs.data?.items.length ? (
            <p className="px-5 py-4 text-sm text-muted">For example: registration certificate, 12A/80G or trust deed.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {docs.data.items.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="text-[12px] text-muted">{formatDate(d.createdAt)}</span>
                  <button className="font-medium text-brand" onClick={() => void open(d.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {uploading && <OrgDocUpload onClose={() => setUploading(false)} onDone={() => qc.invalidateQueries({ queryKey: ['partner', 'organisation', 'documents'] })} />}
    </>
  );
}

function PartnerForm({ o }: { o: PartnerOrg }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(partnerProfileSchema);
  const [v, setV] = useState({
    legalName: o.legalName,
    partnerSubtype: o.partnerSubtype ?? '',
    city: o.city ?? '',
    address: o.address ?? '',
    website: o.website ?? '',
    registrationNumber: o.registrationNumber ?? '',
    programmeInterests: o.programmeInterests ?? '',
    contactName: o.contactName ?? '',
    contactEmail: o.contactEmail ?? '',
    contactPhone: (o.contactPhone ?? '').replace(/^\+91/, ''),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      noValidate
      className="card space-y-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        void f.submit(v, async (data) => {
          qc.setQueryData(['partner', 'organisation'], await api.put<PartnerOrg>('/partner/organisation', data));
          toast('success', 'Organisation saved');
        });
      }}
    >
      {f.formError && <ErrorNote message={f.formError} />}
      {o.identityLocked && (
        <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          The registered name and number were verified by VTA. Contact VTA to change them.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered name" htmlFor="po-name" error={f.errors.legalName}>
          <input id="po-name" className="field-input" value={v.legalName} onChange={set('legalName')} disabled={o.identityLocked} />
        </Field>
        <Field label="Registration number (optional)" htmlFor="po-reg" error={f.errors.registrationNumber}>
          <input id="po-reg" className="field-input" value={v.registrationNumber} onChange={set('registrationNumber')} disabled={o.identityLocked} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="po-type" error={f.errors.partnerSubtype}>
          <select id="po-type" className="field-input" value={v.partnerSubtype} onChange={set('partnerSubtype')}>
            <option value="">Choose</option>
            {PARTNER_SUBTYPES.map((s) => (
              <option key={s} value={s}>
                {SUBTYPE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="City" htmlFor="po-city" error={f.errors.city}>
          <input id="po-city" className="field-input" value={v.city} onChange={set('city')} />
        </Field>
      </div>
      <Field label="Programme interests (optional)" htmlFor="po-int" error={f.errors.programmeInterests} hint="Which training programmes you run or want to support.">
        <textarea id="po-int" rows={2} className="field-input h-auto py-2" value={v.programmeInterests} onChange={set('programmeInterests')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Contact person" htmlFor="po-cn" error={f.errors.contactName}>
          <input id="po-cn" className="field-input" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Contact mobile" htmlFor="po-cp" error={f.errors.contactPhone}>
          <input id="po-cp" type="tel" className="field-input" value={v.contactPhone} onChange={set('contactPhone')} />
        </Field>
        <Field label="Contact email" htmlFor="po-ce" error={f.errors.contactEmail}>
          <input id="po-ce" type="email" className="field-input" value={v.contactEmail} onChange={set('contactEmail')} />
        </Field>
      </div>
      <button type="submit" className="btn-primary" disabled={f.submitting}>
        {f.submitting ? 'Saving…' : 'Save organisation'}
      </button>
    </form>
  );
}

function OrgDocUpload({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Upload registration document"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              if (!file || title.trim().length < 2) return setError('Choose a file and give it a title');
              try {
                await uploadFile(`/partner/organisation/documents${qs({ title: title.trim(), fileName: file.name })}`, file);
                await onDone();
                toast('success', 'Document uploaded');
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Upload failed');
              }
            }}
          >
            Upload
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <Field label="File" htmlFor="od-file">
          <input
            id="od-file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-tint file:px-4 file:py-2.5 file:font-semibold file:text-brand"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </Field>
        <Field label="Title" htmlFor="od-title">
          <input id="od-title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
