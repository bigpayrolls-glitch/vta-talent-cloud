import { useQuery, useQueryClient } from '@tanstack/react-query';
import { companyProfileSchema, inviteRecruiterSchema, SECTOR_LABEL, SECTORS, UPLOAD_MAX_BYTES, UPLOAD_TYPES } from '@vta/shared';
import { FileText, Lock, Send, Upload, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, formatDate, Modal, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { useCompany, type Company } from './EmployerLayout';

const STATUS_TEXT: Record<Company['verificationStatus'], string> = {
  pending: 'Waiting for VTA',
  verified: 'Verified by VTA',
  more_info_needed: 'VTA needs more information',
  rejected: 'Not verified',
};

/** EM-01 / EM-02: company profile and verification documents, sent to VTA for checking. */
export function CompanyPage() {
  const { can } = useAuth();
  const q = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const docs = useQuery({ queryKey: ['employer', 'company', 'documents'], queryFn: () => api.get<{ items: { id: string; title: string; sizeBytes: number; createdAt: string }[] }>('/employer/company/documents') });
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const isAdmin = can('employer.company');

  const submit = async () => {
    setSubmitError('');
    try {
      await api.post('/employer/company/submit');
      await qc.invalidateQueries({ queryKey: ['employer'] });
      toast('success', 'Sent to VTA for checking');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'Could not send');
    }
  };
  const open = async (id: string) => {
    const { url } = await api.get<{ url: string }>(`/employer/company/documents/${id}/link`);
    window.open(url, '_blank', 'noopener');
  };

  return (
    <>
      <PageHeader title="Company" description="VTA checks your company before you can publish jobs or search candidates." />
      <section className="card mb-6 flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">Verification</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {c.verificationStatus === 'pending' && !c.submittedAt ? (
              <StatusBadge status="not_sent" label="Not sent to VTA yet" />
            ) : (
              <StatusBadge status={c.verificationStatus} label={STATUS_TEXT[c.verificationStatus]} />
            )}
            {c.submittedAt && c.verificationStatus === 'pending' && <span className="text-sm text-muted">Sent {formatDate(c.submittedAt)}</span>}
          </div>
          {c.verificationReason && <p className="mt-2 text-sm">VTA&apos;s note: {c.verificationReason}</p>}
        </div>
        {isAdmin && (c.verificationStatus === 'pending' || c.verificationStatus === 'more_info_needed') && (
          <button className="btn-primary" onClick={() => void submit()}>
            <Send className="size-4" aria-hidden />
            {c.submittedAt ? 'Send again' : 'Send to VTA'}
          </button>
        )}
        {submitError && (
          <div className="w-full">
            <ErrorNote message={submitError} />
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {isAdmin ? <CompanyForm c={c} /> : <CompanyView c={c} />}
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
            <p className="px-5 py-4 text-sm text-muted">For example: GST certificate, shop and establishment licence, or company registration.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {docs.data.items.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <button className="font-medium text-brand" onClick={() => void open(d.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={() => qc.invalidateQueries({ queryKey: ['employer', 'company', 'documents'] })} />}
    </>
  );
}

function CompanyView({ c }: { c: Company }) {
  return (
    <dl className="card divide-y divide-line text-sm">
      {(
        [
          ['Registered name', c.legalName],
          ['Sector', c.sector ? SECTOR_LABEL[c.sector as keyof typeof SECTOR_LABEL] : null],
          ['City', c.city],
          ['GSTIN', c.gstin],
          ['Contact', [c.contactName, c.contactPhone, c.contactEmail].filter(Boolean).join(', ')],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="grid gap-0.5 px-5 py-2.5 sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">{k}</dt>
          <dd>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompanyForm({ c }: { c: Company }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(companyProfileSchema);
  const [v, setV] = useState({
    legalName: c.legalName,
    sector: c.sector ?? '',
    city: c.city ?? '',
    address: c.address ?? '',
    website: c.website ?? '',
    description: c.description ?? '',
    gstin: c.gstin ?? '',
    contactName: c.contactName ?? '',
    contactEmail: c.contactEmail ?? '',
    contactPhone: (c.contactPhone ?? '').replace(/^\+91/, ''),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      noValidate
      className="card space-y-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        void f.submit(v, async (data) => {
          const res = await api.put<Company>('/employer/company', data);
          qc.setQueryData(['employer', 'company'], res);
          toast('success', 'Company profile saved');
        });
      }}
    >
      {f.formError && <ErrorNote message={f.formError} />}
      {c.identityLocked && (
        <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          The registered name and GSTIN were verified by VTA. Contact VTA to change them.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered name" htmlFor="c-name" error={f.errors.legalName}>
          <input id="c-name" className="field-input" value={v.legalName} onChange={set('legalName')} disabled={c.identityLocked} />
        </Field>
        <Field label="GSTIN (optional)" htmlFor="c-gst" error={f.errors.gstin}>
          <input id="c-gst" className="field-input uppercase" value={v.gstin} onChange={set('gstin')} disabled={c.identityLocked} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sector" htmlFor="c-sector" error={f.errors.sector}>
          <select id="c-sector" className="field-input" value={v.sector} onChange={set('sector')}>
            <option value="">Choose</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {SECTOR_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="City" htmlFor="c-city" error={f.errors.city}>
          <input id="c-city" className="field-input" value={v.city} onChange={set('city')} />
        </Field>
      </div>
      <Field label="Address (optional)" htmlFor="c-addr" error={f.errors.address}>
        <input id="c-addr" className="field-input" value={v.address} onChange={set('address')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Contact person" htmlFor="c-cn" error={f.errors.contactName}>
          <input id="c-cn" className="field-input" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Contact mobile" htmlFor="c-cp" error={f.errors.contactPhone}>
          <input id="c-cp" type="tel" inputMode="numeric" className="field-input" value={v.contactPhone} onChange={set('contactPhone')} />
        </Field>
        <Field label="Contact email" htmlFor="c-ce" error={f.errors.contactEmail}>
          <input id="c-ce" type="email" className="field-input" value={v.contactEmail} onChange={set('contactEmail')} />
        </Field>
      </div>
      <Field label="Website (optional)" htmlFor="c-web" error={f.errors.website}>
        <input id="c-web" className="field-input" value={v.website} onChange={set('website')} />
      </Field>
      <Field label="About the company (optional)" htmlFor="c-desc" error={f.errors.description}>
        <textarea id="c-desc" rows={3} className="field-input h-auto py-2" value={v.description} onChange={set('description')} />
      </Field>
      <button type="submit" className="btn-primary" disabled={f.submitting}>
        {f.submitting ? 'Saving…' : 'Save company profile'}
      </button>
    </form>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
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
      await uploadFile(`/employer/company/documents${qs({ title: title.trim(), fileName: file!.name })}`, file!);
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
      title="Upload registration document"
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
        <Field label="File" htmlFor="cd-file" error={errors.file} hint={`${Object.values(UPLOAD_TYPES).join(', ')}, up to 10 MB.`}>
          <input
            id="cd-file"
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
        <Field label="Title" htmlFor="cd-title" error={errors.title}>
          <input id="cd-title" className="field-input" placeholder="For example, GST certificate" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

interface Member {
  assignmentId: string;
  userId: string;
  name: string;
  email: string | null;
  role: 'employer_admin' | 'employer_recruiter';
  status: string;
  lastLoginAt: string | null;
  isMe: boolean;
}

/** EM-02: the employer admin manages recruiters. */
export function TeamPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['employer', 'team'], queryFn: () => api.get<{ items: Member[] }>('/employer/team') });
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  return (
    <>
      <PageHeader
        title="Team"
        description="Recruiters can post jobs, search candidates and manage applications. Only admins change the company profile and team."
        actions={
          <button className="btn-primary" onClick={() => setInviting(true)}>
            <UserPlus className="size-4" aria-hidden />
            Invite recruiter
          </button>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title="No team members" />
      ) : (
        <ul className="card divide-y divide-line">
          {q.data.items.map((m) => (
            <li key={m.assignmentId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {m.name}
                  {m.isMe && <span className="font-normal text-muted"> (you)</span>}
                </span>
                <span className="block text-sm text-muted">
                  {m.role === 'employer_admin' ? 'Employer admin' : 'Recruiter'}, {m.email}
                </span>
              </span>
              <StatusBadge status={m.status} />
              {m.role === 'employer_recruiter' && (
                <button className="btn-quiet btn-sm" onClick={() => setRemoving(m)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {inviting && <InviteRecruiterModal onClose={() => setInviting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['employer', 'team'] })} />}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove from team?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await api.post(`/employer/team/${removing!.assignmentId}/remove`);
                await qc.invalidateQueries({ queryKey: ['employer', 'team'] });
                toast('success', `${removing!.name} no longer has access`);
                setRemoving(null);
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <p>{removing?.name} will lose access to your jobs and applicants straight away.</p>
      </Modal>
    </>
  );
}

function InviteRecruiterModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const f = useForm(inviteRecruiterSchema);
  const [v, setV] = useState({ name: '', email: '' });
  const [link, setLink] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite recruiter"
      footer={
        link ? (
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={f.submitting}
              onClick={() =>
                void f.submit(v, async (data) => {
                  const res = await api.post<{ devInviteUrl?: string }>('/employer/team', data);
                  await onDone();
                  toast('success', `Invitation sent to ${data.email}`);
                  if (res.devInviteUrl) setLink(res.devInviteUrl);
                  else onClose();
                })
              }
            >
              Send invitation
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="space-y-2 text-sm">
          <p>No email service is connected yet (development), so here is the invitation link to pass on:</p>
          <p className="break-all rounded-lg bg-surface px-3 py-2 font-mono text-[13px]">{link}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {f.formError && <ErrorNote message={f.formError} />}
          <Field label="Name" htmlFor="r-name" error={f.errors.name}>
            <input id="r-name" className="field-input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Work email" htmlFor="r-email" error={f.errors.email}>
            <input id="r-email" type="email" className="field-input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
