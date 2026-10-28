import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COURSE_CATEGORY_LABEL, type Page, type PartnerCourse } from '@vta/shared';
import { ArrowLeft, ArrowRight, Ban, CheckCircle2, Eye, EyeOff, MessageSquareWarning, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { SearchBox } from '../../components/form';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, formatDate } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { useListParams } from '../../lib/useListParams';
import { ApprovalBadge, BatchBadge, CourseSummary, CourseThumb, fmtDay, HistoryList, rupees } from '../partner/courseParts';

/** AutoTalent Grid: courses that training partners submitted (wireframe screen 7). */

const TABS = [
  { value: 'submitted', label: 'Pending review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
] as const;

export function CourseApprovalsPage() {
  const { values, page, set, setPage } = useListParams(['q', 'approvalStatus'] as const);
  // No filter in the URL means "Pending review"; "all" means every status.
  const raw = values.approvalStatus || 'submitted';
  const status = raw === 'all' ? '' : raw;
  const q = useQuery({
    queryKey: ['course-reviews', values.q, status, page],
    queryFn: () => api.get<Page<PartnerCourse> & { counts: Record<string, number> }>(`/admin/course-reviews${qs({ q: values.q, approvalStatus: status, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  const counts = q.data?.counts ?? {};
  const all = Object.values(counts).reduce((n, x) => n + x, 0);

  return (
    <div>
      <PageHeader title="Course approvals" description="Courses from training partners. Learners see a course only after you approve and publish it." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => {
          const n = t.value ? counts[t.value] ?? 0 : all;
          const active = raw === (t.value || 'all');
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => set('approvalStatus', t.value || 'all')}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-4">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by course or partner" label="Search courses" />
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title={status === 'submitted' ? 'Nothing waiting for review' : 'No courses here'} body="When a training partner submits a course, it appears in Pending review." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/admin/course-approvals/${c.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-surface/60">
                    <CourseThumb c={c} className="size-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.title}</span>
                      <span className="block text-sm text-muted">
                        {c.owner?.name} · {COURSE_CATEGORY_LABEL[c.skillArea]} · {c.city ?? '—'} · {c.totalFeeRupees ? `${rupees(c.totalFeeRupees)} incl. GST` : 'Free'}
                      </span>
                    </span>
                    <span className="text-sm text-muted">{c.submittedAt ? `Submitted ${formatDate(c.submittedAt)}` : ''}</span>
                    <ApprovalBadge status={c.approvalStatus} active={c.active} />
                    <ArrowRight className="size-4 text-brand" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

interface ReviewDetail extends PartnerCourse {
  history: { action: string; note: string | null; actor: string | null; at: string }[];
  batches: { id: string; name: string; status: string; startDate: string; endDate: string; capacity: number; enrolled: number; centre: string; trainer: string }[];
  partner: {
    id: string;
    name: string;
    type: string | null;
    verificationStatus: string;
    city: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    centres: { name: string; city: string | null; status: string }[];
    publishedCourses: number;
  };
}

const REVIEW_TABS = [
  ['details', 'Course details'],
  ['content', 'Content'],
  ['fee', 'Fee & batch'],
  ['partner', 'Partner details'],
  ['history', 'History'],
] as const;

export function CourseReviewPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof REVIEW_TABS)[number][0]>('details');
  const [action, setAction] = useState<'publish' | 'request_changes' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['course-review', id], queryFn: () => api.get<ReviewDetail>(`/admin/course-reviews/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const pending = c.approvalStatus === 'submitted';

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['course-review', id] });
    await qc.invalidateQueries({ queryKey: ['course-reviews'] });
  };

  async function decide() {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ batchProblem: string | null }>(`/admin/course-reviews/${id}/decision`, { action, note: note || undefined });
      await refresh();
      toast('success', action === 'publish' ? 'Approved and published' : action === 'reject' ? 'Course rejected' : 'Sent back to the partner');
      if (r.batchProblem) toast('error', `Published, but the first batch was not created: ${r.batchProblem}`);
      setAction(null);
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.note ?? e.message) : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility() {
    await api.post(`/admin/course-reviews/${id}/${c.active ? 'unpublish' : 'republish'}`);
    await refresh();
    toast('success', c.active ? 'Hidden from learners' : 'Visible to learners again');
  }

  return (
    <div>
      <Link to="/admin/course-approvals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
        <ArrowLeft className="size-4" aria-hidden /> Course approvals
      </Link>

      <div className="card mt-3 flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center">
        <CourseThumb c={c} className="h-24 w-full lg:w-40" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-bold tracking-tight">{c.title}</h1>
            {pending ? <StatusBadge status="submitted" label="Pending review" /> : <ApprovalBadge status={c.approvalStatus} active={c.active} />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {c.owner?.name} · submitted {formatDate(c.submittedAt, true)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(pending || c.approvalStatus === 'changes_requested') && (
            <button className="btn-secondary" onClick={() => setAction('reject')}>
              <Ban className="size-4" aria-hidden /> Reject
            </button>
          )}
          {pending && (
            <>
              <button className="btn-secondary" onClick={() => setAction('request_changes')}>
                <MessageSquareWarning className="size-4" aria-hidden /> Request changes
              </button>
              <button className="btn-primary" onClick={() => setAction('publish')}>
                <CheckCircle2 className="size-4" aria-hidden /> Approve & publish
              </button>
            </>
          )}
          {c.approvalStatus === 'published' && (
            <button className="btn-secondary" onClick={() => void toggleVisibility()}>
              {c.active ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {c.active ? 'Hide from learners' : 'Show to learners'}
            </button>
          )}
        </div>
      </div>

      {c.partner.verificationStatus !== 'verified' && pending && (
        <p className="mt-4 rounded-xl border border-warning/40 bg-warning-tint px-4 py-3 text-sm">
          This training partner is not verified yet. Verify it in Organisations before publishing its courses.
        </p>
      )}

      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {REVIEW_TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="card mt-4 px-5 py-6 sm:px-7">
        {(tab === 'details' || tab === 'content' || tab === 'fee') && <CourseSummary c={c} section={tab} />}
        {tab === 'fee' && c.batches.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 font-semibold">Batches</h3>
            <ul className="divide-y divide-line text-sm">
              {c.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Link to={`/admin/batches/${b.id}`} className="flex-1 font-medium hover:text-brand">{b.name}</Link>
                  <span className="text-muted">{fmtDay(b.startDate)} – {fmtDay(b.endDate)} · {b.enrolled}/{b.capacity}</span>
                  <BatchBadge status={b.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {tab === 'partner' && (
          <div className="grid gap-6 md:grid-cols-2">
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Organisation</dt><dd className="text-right font-medium"><Link className="hover:text-brand" to={`/admin/organisations/${c.partner.id}`}>{c.partner.name}</Link></dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Verification</dt><dd><StatusBadge status={c.partner.verificationStatus} /></dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Type</dt><dd className="text-right">{c.partner.type?.replace('_', ' ') ?? '—'}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">City</dt><dd className="text-right">{c.partner.city ?? '—'}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Contact</dt><dd className="text-right">{[c.partner.contactName, c.partner.email, c.partner.phone].filter(Boolean).join(', ') || '—'}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Website</dt><dd className="text-right">{c.partner.website ?? '—'}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Published courses</dt><dd className="text-right">{c.partner.publishedCourses}</dd></div>
            </dl>
            <div>
              <h3 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand" aria-hidden /> Centres</h3>
              <ul className="divide-y divide-line text-sm">
                {c.partner.centres.map((ce) => (
                  <li key={ce.name} className="flex justify-between py-2"><span>{ce.name}{ce.city ? `, ${ce.city}` : ''}</span><StatusBadge status={ce.status} /></li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {tab === 'history' && <HistoryList items={c.history} />}
      </div>

      <Modal
        open={!!action}
        onClose={() => { setAction(null); setError(''); }}
        title={action === 'publish' ? 'Approve and publish this course?' : action === 'reject' ? 'Reject this course?' : 'Request changes'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAction(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => void decide()}>
              {action === 'publish' ? 'Approve & publish' : action === 'reject' ? 'Reject course' : 'Send to partner'}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {error && <ErrorNote message={error} />}
          {action === 'publish' && (
            <p>Learners will be able to find “{c.title}” and enrol. {c.firstBatch ? `The first batch, ${c.firstBatch.name}, opens for enrolment now.` : ''} {c.partner.name} will be notified.</p>
          )}
          {action === 'reject' && <p>The partner cannot change or resubmit a rejected course. Tell them why.</p>}
          {action === 'request_changes' && <p>The course goes back to the partner to edit and resubmit. Say exactly what to change.</p>}
          <Field label={action === 'publish' ? 'Note to the partner (optional)' : 'Note to the partner'} htmlFor="rv-note">
            <textarea id="rv-note" rows={4} className="field-input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'request_changes' ? 'For example, add a workshop safety module and correct the fee.' : ''} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
