import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPLICATION_STATUS_LABEL,
  INTERVIEW_MODE_LABEL,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOME_LABEL,
  INTERVIEW_OUTCOMES,
  interviewSchema,
  moveApplicationSchema,
  type ApplicationStatus,
} from '@vta/shared';
import { ArrowLeft, Award, CalendarPlus, ExternalLink, FileText, Lock, Mail, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, formatPhone, Modal, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useForm } from '../../lib/useForm';
import { dateTime, experienceHave, shortDate, skillLabel } from '../hiring/format';

interface Interview {
  id: string;
  scheduledAt: string;
  mode: (typeof INTERVIEW_MODES)[number];
  location: string | null;
  outcome: (typeof INTERVIEW_OUTCOMES)[number];
  internalNotes: string | null;
}
interface ApplicationDetail {
  id: string;
  jobId: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedAt: string;
  note: string | null;
  joiningDate: string | null;
  outcomeVerification: string;
  nextMoves: ApplicationStatus[];
  consent: { sharedAt: string; fields: string[] };
  candidate: {
    name: string;
    phone: string | null;
    email: string | null;
    contactShared: boolean;
    /** Phase 12: shared by the candidate, but not part of the employer's plan. */
    contactNeedsUpgrade: boolean;
    code: string;
    city: string;
    state: string | null;
    preferredWorkArea: string | null;
    skillAreas: string[];
    experienceMonths: number;
    education: string | null;
    languages: string[];
    availability: string | null;
    verificationStatus: string;
  };
  certificates: { id: string; course: string; issueDate: string; verifyPath: string }[];
  documents: { id: string; kind: string; title: string; verificationStatus: string }[];
  interviews: Interview[];
  interviewsOnPlan: boolean;
  timeline: { id: string; from: string | null; to: ApplicationStatus; by: string; byName: string | null; at: string }[];
}

const MOVE_LABEL: Partial<Record<ApplicationStatus, string>> = {
  shortlisted: 'Shortlist',
  interview: 'Move to interview',
  offer: 'Record offer',
  joined: 'Record joining',
  not_joined: 'Did not join',
  rejected: 'Not selected',
};

/** EM-05 to EM-08, EM-10: one applicant. Opening this page is logged because it shows contact details. */
export function EmployerApplicationPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['employer', 'application', id], queryFn: () => api.get<ApplicationDetail>(`/employer/applications/${id}`) });
  const [moving, setMoving] = useState<ApplicationStatus | null>(null);
  const [interview, setInterview] = useState<Interview | 'new' | null>(null);
  const [error, setError] = useState('');
  if (q.isLoading) return <Spinner />;
  if (q.isError)
    return (
      <>
        <ErrorNote message={(q.error as Error).message} />
        {q.error instanceof ApiError && q.error.fields.plan === 'upgrade' && (
          <Link to="/employer/subscription/plans" className="btn-primary mt-3">
            See plans
          </Link>
        )}
      </>
    );
  const a = q.data!;
  const p = a.candidate;
  const refresh = () => qc.invalidateQueries({ queryKey: ['employer'] });

  const move = async (to: ApplicationStatus) => {
    if (to === 'joined' || to === 'rejected') return setMoving(to);
    setError('');
    try {
      await api.post(`/employer/applications/${id}/move`, { to });
      await refresh();
      toast('success', `Moved to ${APPLICATION_STATUS_LABEL[to]}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const openDoc = async (docId: string) => {
    try {
      const { url } = await api.get<{ url: string }>(`/employer/applications/${id}/documents/${docId}/link`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not open the document');
    }
  };

  return (
    <>
      <Link to={`/employer/jobs/${a.jobId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {a.jobTitle}
      </Link>
      <header className="mb-5 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{p.name}</h1>
          <p className="mt-1 text-muted">
            {p.code}. Applied {shortDate(a.appliedAt)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={a.status} label={APPLICATION_STATUS_LABEL[a.status]} />
            <StatusBadge status={p.verificationStatus} label={p.verificationStatus === 'verified' ? 'Verified by AutoTalent Grid' : `Profile ${p.verificationStatus.replace('_', ' ')}`} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.nextMoves.map((to) => (
            <button key={to} className={to === 'rejected' || to === 'not_joined' ? 'btn-secondary' : 'btn-primary'} onClick={() => void move(to)}>
              {MOVE_LABEL[to] ?? APPLICATION_STATUS_LABEL[to]}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {a.status === 'joined' && a.joiningDate && <p className="mb-4 rounded-lg bg-success-tint px-4 py-3 text-sm text-success">Joined on {shortDate(a.joiningDate)}. AutoTalent Grid may contact you to confirm it.</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="card px-5 py-4">
            <h2 className="font-semibold">Contact</h2>
            {p.contactShared ? (
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <Phone className="size-4 text-muted" aria-hidden />
                  <a href={`tel:${p.phone}`} className="font-medium text-brand">
                    {formatPhone(p.phone)}
                  </a>
                </li>
                {p.email && (
                  <li className="flex items-center gap-2">
                    <Mail className="size-4 text-muted" aria-hidden />
                    <a href={`mailto:${p.email}`} className="font-medium text-brand">
                      {p.email}
                    </a>
                  </li>
                )}
                <li className="pt-1 text-[13px] text-muted">Shared by the candidate when they applied on {shortDate(a.consent.sharedAt)}. Opening this page is logged.</li>
              </ul>
            ) : p.contactNeedsUpgrade ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Lock className="size-4" aria-hidden />
                Contact details and documents are part of the Starter plan and above.
                <Link to="/employer/subscription/plans" className="font-semibold text-brand underline">
                  Upgrade plan
                </Link>
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Lock className="size-4" aria-hidden />
                The candidate withdrew, so their contact details and documents are no longer shared.
              </p>
            )}
            {a.note && <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm">&ldquo;{a.note}&rdquo;</p>}
          </section>

          <section className="card divide-y divide-line">
            <h2 className="px-5 py-3 font-semibold">Profile</h2>
            {(
              [
                ['City', [p.city, p.state].filter(Boolean).join(', ')],
                ['Preferred work area', p.preferredWorkArea],
                ['Skills', p.skillAreas.map(skillLabel).join(', ')],
                ['Experience', experienceHave(p.experienceMonths)],
                ['Education', p.education],
                ['Languages', p.languages.join(', ')],
                ['Availability', p.availability],
              ] as const
            ).map(([k, val]) => (
              <div key={k} className="grid gap-0.5 px-5 py-2.5 text-sm sm:grid-cols-[180px_1fr]">
                <span className="text-muted">{k}</span>
                <span>{val || '—'}</span>
              </div>
            ))}
          </section>

          {(a.certificates.length > 0 || a.documents.length > 0) && (
            <section className="card px-5 py-4">
              <h2 className="font-semibold">Certificates and documents</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {a.certificates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Award className="size-4 text-brand" aria-hidden />
                    <span className="min-w-0 flex-1">
                      AutoTalent Grid certificate: <span className="font-medium">{c.course}</span>, {shortDate(c.issueDate)}
                    </span>
                    <a href={c.verifyPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand">
                      Check <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
                {a.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <FileText className="size-4 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      {d.title} <StatusBadge status={d.verificationStatus} />
                    </span>
                    <button type="button" className="font-medium text-brand" onClick={() => void openDoc(d.id)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Interviews</h2>
              {a.interviewsOnPlan && ['applied', 'shortlisted', 'interview', 'offer'].includes(a.status) && (
                <button className="btn-secondary btn-sm" onClick={() => setInterview('new')}>
                  <CalendarPlus className="size-4" aria-hidden />
                  Schedule
                </button>
              )}
            </div>
            {!a.interviewsOnPlan ? (
              <p className="mt-2 text-sm text-muted">
                Interview management is part of the Starter plan and above.{' '}
                <Link to="/employer/subscription/plans" className="font-semibold text-brand underline">
                  Upgrade plan
                </Link>
              </p>
            ) : !a.interviews.length ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {a.interviews.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block font-medium">{dateTime(i.scheduledAt)}</span>
                        <span className="text-muted">
                          {INTERVIEW_MODE_LABEL[i.mode]}
                          {i.location ? `, ${i.location}` : ''}. {INTERVIEW_OUTCOME_LABEL[i.outcome]}
                        </span>
                      </span>
                      <button type="button" className="text-[13px] font-medium text-brand" onClick={() => setInterview(i)}>
                        Edit
                      </button>
                    </div>
                    {i.internalNotes && <p className="mt-1 rounded bg-surface px-2 py-1 text-[13px]">{i.internalNotes}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
              <Lock className="size-3" aria-hidden />
              Notes are seen only by your team.
            </p>
          </section>
          <section className="card px-5 py-4">
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {a.timeline.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>
                    {APPLICATION_STATUS_LABEL[e.to]}
                    <span className="text-muted"> {e.by === 'candidate' ? 'by the candidate' : e.byName ? `by ${e.byName}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-muted">{dateTime(e.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {moving && <MoveModal id={id} to={moving} onClose={() => setMoving(null)} onDone={refresh} />}
      {interview && <InterviewModal applicationId={id} interview={interview === 'new' ? null : interview} onClose={() => setInterview(null)} onDone={refresh} />}
    </>
  );
}

function MoveModal({ id, to, onClose, onDone }: { id: string; to: ApplicationStatus; onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const f = useForm(moveApplicationSchema);
  const [joiningDate, setJoiningDate] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={to === 'joined' ? 'Record joining' : 'Not selected'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={f.submitting}
            onClick={() =>
              void f.submit({ to, ...(to === 'joined' ? { joiningDate } : { reason }) }, async (data) => {
                await api.post(`/employer/applications/${id}/move`, data);
                await onDone();
                toast('success', to === 'joined' ? 'Joining recorded' : 'Marked as not selected');
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      {f.formError && <ErrorNote message={f.formError} />}
      {to === 'joined' ? (
        <Field label="Joining date" htmlFor="m-join" error={f.errors.joiningDate} hint="Record a joining once the person has started. An offer alone is not a joining.">
          <input id="m-join" type="date" className="field-input" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
        </Field>
      ) : (
        <Field label="Reason (seen only by your team and AutoTalent Grid)" htmlFor="m-reason" error={f.errors.reason}>
          <textarea id="m-reason" rows={3} className="field-input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function InterviewModal({ applicationId, interview, onClose, onDone }: { applicationId: string; interview: Interview | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const f = useForm(interviewSchema);
  const [v, setV] = useState({
    scheduledAt: interview ? toLocalInput(interview.scheduledAt) : '',
    mode: interview?.mode ?? 'in_person',
    location: interview?.location ?? '',
    outcome: interview?.outcome ?? 'scheduled',
    internalNotes: interview?.internalNotes ?? '',
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal
      open
      onClose={onClose}
      title={interview ? 'Interview' : 'Schedule interview'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={f.submitting}
            onClick={() =>
              void f.submit({ ...v, scheduledAt: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : '' }, async (data) => {
                if (interview) await api.put(`/employer/interviews/${interview.id}`, data);
                else await api.post(`/employer/applications/${applicationId}/interviews`, data);
                await onDone();
                toast('success', interview ? 'Interview updated' : 'Interview scheduled');
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Date and time" htmlFor="i-at" error={f.errors.scheduledAt}>
          <input id="i-at" type="datetime-local" className="field-input" value={v.scheduledAt} onChange={set('scheduledAt')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How" htmlFor="i-mode">
            <select id="i-mode" className="field-input" value={v.mode} onChange={set('mode')}>
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {INTERVIEW_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {interview && (
            <Field label="Outcome" htmlFor="i-out">
              <select id="i-out" className="field-input" value={v.outcome} onChange={set('outcome')}>
                {INTERVIEW_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {INTERVIEW_OUTCOME_LABEL[o]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label="Where (optional)" htmlFor="i-loc" error={f.errors.location} hint="The candidate sees the time, how and where.">
          <input id="i-loc" className="field-input" value={v.location} onChange={set('location')} />
        </Field>
        <Field label="Internal notes (your team only)" htmlFor="i-notes" error={f.errors.internalNotes}>
          <textarea id="i-notes" rows={3} className="field-input h-auto py-2" value={v.internalNotes} onChange={set('internalNotes')} />
        </Field>
      </div>
    </Modal>
  );
}
