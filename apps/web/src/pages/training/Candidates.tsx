import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  candidateSchema,
  candidateUpdateSchema,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KINDS,
  SKILL_AREA_LABEL,
  SKILL_AREAS,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  type Page,
} from '@vta/shared';
import { AlertTriangle, ArrowLeft, Download, FileText, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SearchBox, Select, SkillAreaPicker, SkillTags } from '../../components/form';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, formatDate, formatPhone, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { useListParams } from '../../lib/useListParams';
import { ChangePhoneButton } from '../admin/ChangePhone';
import { ReasonModal } from './Trainers';

interface CandidateRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  city: string;
  skillAreas: string[];
  experienceMonths: number;
  verificationStatus: string;
  possibleDuplicate: boolean;
  userStatus: string;
}
interface CandidateDetail extends Omit<CandidateRow, 'possibleDuplicate'> {
  email: string | null;
  dateOfBirth: string | null;
  age: number | null;
  state: string | null;
  education: string | null;
  languages: string[];
  searchable: boolean;
  verificationReason: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  source: string;
  lastLoginAt: string | null;
  createdAt: string;
  possibleDuplicate: { id: string; name: string; code: string; city: string; status: string } | null;
  enrolments: { id: string; status: string; enrolledAt: string; batchId: string; batchName: string; batchStatus: string; courseTitle: string; centreName: string }[];
  noticeAccepted: boolean;
  noticeAcceptedAt: string | null;
  documents: { id: string; kind: keyof typeof DOCUMENT_KIND_LABEL; title: string; fileName: string; mimeType: string; sizeBytes: number; verificationStatus: string; reviewReason: string | null; scanStatus: string; visibility: 'private' | 'employers'; uploadedBySelf: boolean; createdAt: string }[];
}

const experience = (m: number) => (m === 0 ? 'No experience' : m < 12 ? `${m} months` : `${Math.floor(m / 12)} yr${m >= 24 ? 's' : ''}${m % 12 ? ` ${m % 12} mo` : ''}`);
const fileSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function CandidatesPage() {
  const { can } = useAuth();
  const manage = can('candidate.manage');
  const { values, page, set, setPage } = useListParams(['q', 'verificationStatus', 'skillArea', 'duplicates'] as const);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['candidates', values, page],
    queryFn: () => api.get<Page<CandidateRow>>(`/admin/candidates${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title="Candidates"
        description={manage ? 'Technician profiles: add them one by one or import a spreadsheet, then verify.' : 'Candidates enrolled at your centre.'}
        actions={
          manage && (
            <>
              <Link to="/admin/candidates/import" className="btn-secondary">
                <Upload className="size-4" aria-hidden />
                Import CSV
              </Link>
              <button className="btn-primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                Add candidate
              </button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by name, candidate ID or mobile" label="Search candidates" />
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Select id="cd-status" label="Verification" className="sm:w-44" value={values.verificationStatus} onChange={(v) => set('verificationStatus', v)} options={[{ value: '', label: 'Any status' }, { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'needs_correction', label: 'Needs correction' }, { value: 'rejected', label: 'Rejected' }]} />
          <Select id="cd-skill" label="Skill area" className="sm:w-44" value={values.skillArea} onChange={(v) => set('skillArea', v)} options={[{ value: '', label: 'All skills' }, ...SKILL_AREAS.map((s) => ({ value: s, label: SKILL_AREA_LABEL[s] }))]} />
          <label className="col-span-2 flex h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-line px-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={values.duplicates === 'true'} onChange={(e) => set('duplicates', e.target.checked ? 'true' : '')} />
            Possible duplicates
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No candidates match" body="Try a different search or clear the filters." />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-line bg-surface/60 text-[13px] text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Candidate</th>
                  <th className="px-4 py-3 font-medium">City</th>
                  <th className="px-4 py-3 font-medium">Skills</th>
                  <th className="px-4 py-3 font-medium">Experience</th>
                  <th className="px-4 py-3 font-medium">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data!.items.map((c) => (
                  <tr key={c.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3">
                      <Link to={`/admin/candidates/${c.id}`} className="font-semibold hover:text-brand">{c.name}</Link>
                      <span className="block text-[13px] text-muted">{c.code}</span>
                    </td>
                    <td className="px-4 py-3">{c.city}</td>
                    <td className="px-4 py-3"><SkillTags areas={c.skillAreas} /></td>
                    <td className="px-4 py-3 text-muted">{experience(c.experienceMonths)}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={c.verificationStatus} />
                        {c.possibleDuplicate && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning">
                            <AlertTriangle className="size-3.5" aria-hidden />
                            Possible duplicate
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {q.data!.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/admin/candidates/${c.id}`} className="block px-4 py-3.5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{c.name}</span>
                      <StatusBadge status={c.verificationStatus} />
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{c.code}, {c.city}</span>
                    {c.possibleDuplicate && <span className="mt-1 block text-xs font-semibold text-warning">Possible duplicate</span>}
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
      {adding && <CandidateModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function CandidateModal({ candidate, onClose }: { candidate?: CandidateDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const f = useForm(candidate ? candidateUpdateSchema : candidateSchema);
  const [v, setV] = useState({
    name: candidate?.name ?? '',
    phone: '',
    email: candidate?.email ?? '',
    dateOfBirth: candidate?.dateOfBirth ?? '',
    city: candidate?.city ?? '',
    state: candidate?.state ?? 'Karnataka',
    experienceMonths: String(candidate?.experienceMonths ?? 0),
    education: candidate?.education ?? '',
    languages: candidate?.languages.join(', ') ?? '',
  });
  const [skills, setSkills] = useState<string[]>(candidate?.skillAreas ?? []);
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const err = f.errors;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={candidate ? `Edit ${candidate.name}` : 'Add candidate'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="cand-form" disabled={f.submitting}>{candidate ? 'Save changes' : 'Add candidate'}</button>
        </>
      }
    >
      <form
        id="cand-form"
        noValidate
        className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {
            ...Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== '' && k !== 'languages' && !(candidate && k === 'phone'))),
            skillAreas: skills,
            languages: v.languages.split(',').map((x) => x.trim()).filter(Boolean),
          };
          void f.submit(body, async (data) => {
            if (candidate) {
              const r = await api.patch<{ possibleDuplicate: boolean }>(`/admin/candidates/${candidate.id}`, data);
              await qc.invalidateQueries({ queryKey: ['candidate'] });
              await qc.invalidateQueries({ queryKey: ['candidates'] });
              toast('success', r.possibleDuplicate ? 'Saved. This profile now looks like a possible duplicate.' : 'Candidate updated');
              onClose();
            } else {
              const r = await api.post<{ id: string; code: string; possibleDuplicate: boolean }>('/admin/candidates', data);
              await qc.invalidateQueries({ queryKey: ['candidates'] });
              toast('success', `Added as ${r.code}${r.possibleDuplicate ? '. Flagged as a possible duplicate.' : ''}`);
              navigate(`/admin/candidates/${r.id}`);
            }
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="cf-name" error={err.name}>
            <input id="cf-name" autoFocus className="field-input" value={v.name} onChange={upd('name')} />
          </Field>
          {candidate ? (
            <Field label="Mobile number" htmlFor="cf-phone" hint="The number they sign in with cannot be changed here.">
              <input id="cf-phone" className="field-input" value={formatPhone(candidate.phone)} disabled />
            </Field>
          ) : (
            <Field label="Mobile number" htmlFor="cf-phone" error={err.phone} hint="They sign in with a code sent here.">
              <input id="cf-phone" type="tel" inputMode="numeric" className="field-input" placeholder="98765 43210" value={v.phone} onChange={upd('phone')} />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth" htmlFor="cf-dob" error={err.dateOfBirth} hint="Candidates must be 18 or older during the pilot.">
            <input id="cf-dob" type="date" className="field-input" value={v.dateOfBirth} onChange={upd('dateOfBirth')} />
          </Field>
          <Field label="Email (optional)" htmlFor="cf-email" error={err.email}>
            <input id="cf-email" type="email" className="field-input" value={v.email} onChange={upd('email')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="cf-city" error={err.city}>
            <input id="cf-city" className="field-input" value={v.city} onChange={upd('city')} />
          </Field>
          <Field label="State" htmlFor="cf-state" error={err.state}>
            <input id="cf-state" className="field-input" value={v.state} onChange={upd('state')} />
          </Field>
        </div>
        <div>
          <p className="field-label" id="cf-skills">Skill areas</p>
          <SkillAreaPicker id="cf-skills" value={skills} onChange={setSkills} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Experience (months)" htmlFor="cf-exp" error={err.experienceMonths}>
            <input id="cf-exp" type="number" min={0} className="field-input" value={v.experienceMonths} onChange={upd('experienceMonths')} />
          </Field>
          <Field label="Education (optional)" htmlFor="cf-edu" error={err.education}>
            <input id="cf-edu" className="field-input" placeholder="For example, ITI Motor Mechanic" value={v.education} onChange={upd('education')} />
          </Field>
        </div>
        <Field label="Languages (optional)" htmlFor="cf-lang" error={err.languages} hint="Separate with commas.">
          <input id="cf-lang" className="field-input" placeholder="Kannada, English" value={v.languages} onChange={upd('languages')} />
        </Field>
      </form>
    </Modal>
  );
}

export function CandidateDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const manage = can('candidate.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'reject' | 'request-correction' | null>(null);
  const [uploading, setUploading] = useState(false);
  const q = useQuery({ queryKey: ['candidate', id], queryFn: () => api.get<CandidateDetail>(`/admin/candidates/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['candidate'] });
    await qc.invalidateQueries({ queryKey: ['candidates'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const act = async (path: string, done: string) => {
    try {
      await api.post(`/admin/candidates/${c.id}/${path}`);
      await refresh();
      toast('success', done);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const openDocument = async (docId: string) => {
    try {
      const { url } = await api.get<{ url: string }>(`/files/${docId}/link`);
      window.location.assign(url);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div>
      <Link to="/admin/candidates" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All candidates
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{c.name}</h1>
            <StatusBadge status={c.verificationStatus} />
          </div>
          <p className="mt-1 text-muted">
            {c.code}, {c.userStatus === 'invited' ? 'has not signed in yet' : `account ${c.userStatus}`}
          </p>
          {c.verificationReason && c.verificationStatus !== 'verified' && <p className="mt-1 text-sm text-warning">Reason: {c.verificationReason}</p>}
          {c.verificationStatus === 'verified' && c.verifiedAt && (
            <p className="mt-1 text-sm text-muted">Verified {formatDate(c.verifiedAt)}{c.verifiedByName ? ` by ${c.verifiedByName}` : ''}</p>
          )}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {c.verificationStatus !== 'verified' && (
              <button className="btn-primary" disabled={!!c.possibleDuplicate} title={c.possibleDuplicate ? 'Review the possible duplicate first' : undefined} onClick={() => void act('verify', 'Candidate verified')}>
                Verify
              </button>
            )}
            {c.verificationStatus !== 'needs_correction' && <button className="btn-secondary" onClick={() => setDecision('request-correction')}>Ask for a correction</button>}
            {c.verificationStatus !== 'rejected' && <button className="btn-secondary text-brand" onClick={() => setDecision('reject')}>Reject</button>}
            <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
          </div>
        )}
      </div>

      {c.possibleDuplicate && (
        <div role="alert" className="mb-6 flex flex-wrap items-start gap-4 rounded-[var(--radius-card)] border border-warning/30 bg-warning-tint px-5 py-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-ink">Possible duplicate</p>
            <p className="mt-0.5 text-ink/80">
              Same name and date of birth as <Link className="font-semibold underline" to={`/admin/candidates/${c.possibleDuplicate.id}`}>{c.possibleDuplicate.name} ({c.possibleDuplicate.code}, {c.possibleDuplicate.city})</Link>.
              If they are the same person, reject this profile. If not, mark it as a different person.
            </p>
          </div>
          {manage && <button className="btn-secondary btn-sm" onClick={() => void act('dismiss-duplicate', 'Marked as a different person')}>Different person</button>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold">Profile</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
            <dt className="text-muted">Mobile</dt>
            <dd>
              {formatPhone(c.phone)}
              <ChangePhoneButton userId={c.id} name={c.name} phone={c.phone} className="ml-2 font-medium text-brand hover:underline" />
            </dd>
            <dt className="text-muted">Email</dt>
            <dd>{c.email ?? '—'}</dd>
            <dt className="text-muted">Date of birth</dt>
            <dd>{c.dateOfBirth ? `${formatDate(`${c.dateOfBirth}T00:00:00`)} (${c.age})` : '—'}</dd>
            <dt className="text-muted">Location</dt>
            <dd>{[c.city, c.state].filter(Boolean).join(', ')}</dd>
            <dt className="text-muted">Skills</dt>
            <dd><SkillTags areas={c.skillAreas} /></dd>
            <dt className="text-muted">Experience</dt>
            <dd>{experience(c.experienceMonths)}</dd>
            <dt className="text-muted">Education</dt>
            <dd>{c.education ?? '—'}</dd>
            <dt className="text-muted">Languages</dt>
            <dd>{c.languages.join(', ') || '—'}</dd>
            <dt className="text-muted">Employer search</dt>
            <dd>{c.searchable ? 'Visible' : 'Hidden until the candidate opts in'}</dd>
            <dt className="text-muted">Added</dt>
            <dd>{formatDate(c.createdAt)} ({c.source === 'import' ? 'CSV import' : c.source === 'self' ? 'self-registered' : 'by an admin'})</dd>
            <dt className="text-muted">Privacy notice</dt>
            <dd>{c.noticeAccepted ? `Accepted${c.noticeAcceptedAt ? ` ${formatDate(c.noticeAcceptedAt)}` : ''}` : 'Not yet accepted (asked at first sign-in)'}</dd>
          </dl>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">Documents</h2>
            {can('document.upload') && (
              <button className="btn-quiet btn-sm" onClick={() => setUploading(true)}>
                <Upload className="size-4" aria-hidden />
                Upload
              </button>
            )}
          </div>
          {c.documents.length === 0 ? (
            <EmptyState title="No documents" body="Certificates and experience letters appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-5 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="text-[13px] text-muted">
                      {DOCUMENT_KIND_LABEL[d.kind]}, {fileSize(d.sizeBytes)}, {formatDate(d.createdAt)}
                      {d.uploadedBySelf ? ', uploaded by the candidate' : ''}
                      {d.visibility === 'employers' ? ', employers may see it' : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge status={d.verificationStatus} label={d.verificationStatus === 'pending' ? 'Not checked yet' : d.verificationStatus === 'rejected' ? 'Not accepted' : 'Verified'} />
                      {d.reviewReason && <span className="text-[13px] text-muted">{d.reviewReason}</span>}
                    </div>
                  </div>
                  {manage && <DocumentReview candidateId={c.id} doc={d} />}
                  <button className="btn-secondary btn-sm" onClick={() => void openDocument(d.id)} aria-label={`Download ${d.title}`}>
                    <Download className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Files are private. Each download uses a link that works for 5 minutes. Files are not virus-scanned yet.</p>
        </section>
      </div>

      <section className="card mt-6 overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 font-semibold">Training</h2>
        {c.enrolments.length === 0 ? (
          <EmptyState title="Not enrolled in any batch" body="Enrol candidates from a batch’s page." />
        ) : (
          <ul className="divide-y divide-line">
            {c.enrolments.map((e) => (
              <li key={e.id}>
                <Link to={`/admin/batches/${e.batchId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface/60">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{e.batchName}</span>
                    <span className="block text-sm text-muted">{e.courseTitle}, {e.centreName}</span>
                  </span>
                  <StatusBadge status={e.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <CandidateModal candidate={c} onClose={() => setEditing(false)} />}
      {decision && (
        <ReasonModal
          title={decision === 'reject' ? `Reject ${c.name}?` : 'Ask for a correction'}
          label={decision === 'reject' ? 'Why is this profile rejected?' : 'What needs correcting?'}
          action={decision === 'reject' ? 'Reject' : 'Send request'}
          intro={decision === 'reject' ? 'A rejected candidate cannot be enrolled in batches.' : undefined}
          onClose={() => setDecision(null)}
          onSubmit={(reason) => api.post(`/admin/candidates/${c.id}/${decision}`, { reason }).then(refresh).then(() => toast('success', decision === 'reject' ? 'Candidate rejected' : 'Correction requested'))}
        />
      )}
      {uploading && <UploadModal candidateId={c.id} onClose={() => setUploading(false)} onDone={refresh} />}
    </div>
  );
}

function UploadModal({ candidateId, onClose, onDone }: { candidateId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>('certificate');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const accept = Object.keys(UPLOAD_TYPES).join(',');

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!file) e.file = 'Choose a file';
    else if (file.size > UPLOAD_MAX_BYTES) e.file = 'The file is larger than 10 MB';
    if (title.trim().length < 2) e.title = 'Give the document a title';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await uploadFile(`/admin/candidates/${candidateId}/documents${qs({ kind, title: title.trim(), fileName: file!.name })}`, file!);
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
      title="Upload document"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Uploading…' : 'Upload'}</button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ && <ErrorNote message={errors._} />}
        <Field label="File" htmlFor="up-file" error={errors.file} hint={`${Object.values(UPLOAD_TYPES).join(', ')}, up to 10 MB.`}>
          <input
            ref={input}
            id="up-file"
            type="file"
            accept={accept}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-tint file:px-4 file:py-2.5 file:font-semibold file:text-brand"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </Field>
        <Field label="Type" htmlFor="up-kind">
          <select id="up-kind" className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Title" htmlFor="up-title" error={errors.title}>
          <input id="up-title" className="field-input" placeholder="For example, ITI certificate" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <p className="text-[13px] text-muted">Do not upload Aadhaar or other ID documents unless VTA policy requires it.</p>
      </div>
    </Modal>
  );
}

/** AD-05: VTA verifies or rejects a candidate's document (a reason is needed to reject; the learner sees it). */
function DocumentReview({ candidateId, doc }: { candidateId: string; doc: { id: string; title: string; verificationStatus: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (decision: 'verified' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/admin/candidates/${candidateId}/documents/${doc.id}/review`, decision === 'rejected' ? { decision, reason } : { decision });
      await qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      toast('success', decision === 'verified' ? 'Document verified' : 'Document not accepted; the learner has been told why');
      setRejecting(false);
      setReason('');
    } catch (e) {
      if (e instanceof ApiError) setError(e.fields.reason ?? e.message);
      else setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {doc.verificationStatus !== 'verified' && (
        <button className="btn-secondary btn-sm" disabled={busy} onClick={() => void send('verified')} aria-label={`Verify ${doc.title}`}>
          Verify
        </button>
      )}
      {doc.verificationStatus !== 'rejected' && (
        <button className="btn-secondary btn-sm text-brand" onClick={() => setRejecting(true)} aria-label={`Reject ${doc.title}`}>
          Reject
        </button>
      )}
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={`Reject “${doc.title}”?`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejecting(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void send('rejected')}>Reject</button>
          </>
        }
      >
        <p className="text-sm">The learner sees your reason and can upload a better copy.</p>
        <div className="mt-4">
          <Field label="Reason" htmlFor={`reason-${doc.id}`} error={error}>
            <textarea id={`reason-${doc.id}`} className="field-input min-h-20" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
