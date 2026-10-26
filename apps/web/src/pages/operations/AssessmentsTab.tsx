import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assessmentOutcome } from '@vta/shared';
import { useEffect, useState } from 'react';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, Spinner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ReasonModal } from '../training/Trainers';

interface Row {
  enrolmentId: string;
  candidateId: string;
  name: string;
  code: string;
  resultId: string | null;
  status: 'not_started' | 'draft' | 'submitted' | 'returned' | 'approved';
  totalScore: number | null;
  maxScore: number | null;
  outcome: 'pass' | 'fail' | null;
  submittedAt: string | null;
  returnReason: string | null;
}
interface Criterion {
  id: string;
  label: string;
  maxScore: number;
  required: boolean;
}
interface ResultDto {
  id: string;
  status: string;
  totalScore: number;
  maxScore: number;
  pct: number;
  outcome: 'pass' | 'fail' | null;
  passMarkPct: number;
  trainerComment: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  reviewedByName: string | null;
  reviewReason: string | null;
  candidate: { name: string; code: string };
  criteria: (Criterion & { score: number | null; outcome: 'pass' | 'fail' | 'not_assessed'; comment: string | null })[];
}
interface Form {
  enrolmentId: string;
  candidateName: string;
  passMarkPct: number;
  criteria: Criterion[];
  result: ResultDto | null;
  canEdit: boolean;
}

export const RESULT_LABEL: Record<string, { text: string; cls: string }> = {
  not_started: { text: 'Not started', cls: 'bg-surface text-muted' },
  draft: { text: 'Draft', cls: 'bg-info-tint text-info' },
  submitted: { text: 'Awaiting review', cls: 'bg-warning-tint text-warning' },
  returned: { text: 'Returned for correction', cls: 'bg-brand-tint text-brand' },
  approved: { text: 'Approved', cls: 'bg-success-tint text-success' },
  rejected: { text: 'Rejected', cls: 'bg-surface text-muted' },
};

export function ResultChip({ status, outcome }: { status: string; outcome?: 'pass' | 'fail' | null }) {
  const s = RESULT_LABEL[status] ?? RESULT_LABEL.not_started!;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {s.text}
      </span>
      {outcome && (
        <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${outcome === 'pass' ? 'bg-success-tint text-success' : 'bg-brand-tint text-brand'}`}>{outcome === 'pass' ? 'Pass' : 'Fail'}</span>
      )}
    </span>
  );
}

/** R-03/R-04: assessment status per candidate. Trainers record; reviewers decide; everyone else reads. */
export function AssessmentsTab({ batchId }: { batchId: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['assessments', batchId], queryFn: () => api.get<{ canRecord: boolean; items: Row[] }>(`/batches/${batchId}/assessments`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const { canRecord, items } = q.data!;
  const reviewer = can('assessment.review');

  const action = (r: Row) => {
    if (canRecord && (r.status === 'not_started' || r.status === 'draft' || r.status === 'returned')) return r.status === 'not_started' ? 'Assess' : 'Continue';
    if (reviewer && r.status === 'submitted') return 'Review';
    return r.resultId ? 'View' : null;
  };

  return (
    <section className="card overflow-hidden">
      {items.length === 0 ? (
        <EmptyState title="Nobody enrolled" />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => {
            const a = action(r);
            return (
              <li key={r.enrolmentId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[13px] text-muted">
                    {r.code}
                    {r.maxScore ? `, ${r.totalScore} of ${r.maxScore} marks` : ''}
                    {r.returnReason ? `. Returned: ${r.returnReason}` : ''}
                  </p>
                </div>
                <ResultChip status={r.status} outcome={r.outcome} />
                {a && (
                  <button className={a === 'Review' || a === 'Assess' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setOpen(r)}>
                    {a}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!canRecord && !reviewer && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">The batch trainer records assessments and VTA reviews them.</p>}
      {open && <AssessmentModal row={open} batchId={batchId} onClose={() => setOpen(null)} />}
    </section>
  );
}

type Draft = Record<string, { score: string; outcome: 'pass' | 'fail' | 'not_assessed'; comment: string }>;

function AssessmentModal({ row, batchId, onClose }: { row: Row; batchId: string; onClose: () => void }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<'return' | 'reject' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useQuery({
    queryKey: ['assessment', row.enrolmentId],
    queryFn: () => api.get<Form>(`/enrolments/${row.enrolmentId}/assessment`),
  });
  // Fill the form from the saved result once it has loaded (cached or fresh).
  useEffect(() => {
    const f = form.data;
    if (!f) return;
    const byId = new Map(f.result?.criteria.map((c) => [c.id, c]) ?? []);
    setDraft(Object.fromEntries(f.criteria.map((c) => [c.id, { score: byId.get(c.id)?.score?.toString() ?? '', outcome: byId.get(c.id)?.outcome ?? 'not_assessed', comment: byId.get(c.id)?.comment ?? '' }])));
    setComment(f.result?.trainerComment ?? '');
  }, [form.data]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['assessments', batchId] });
    await qc.invalidateQueries({ queryKey: ['assessment', row.enrolmentId] });
    await qc.invalidateQueries({ queryKey: ['batch', batchId] });
    await qc.invalidateQueries({ queryKey: ['review-queue'] });
  };

  if (form.isLoading || !draft) return <Modal open onClose={onClose} title={row.name}><Spinner /></Modal>;
  if (form.isError) return <Modal open onClose={onClose} title={row.name}><ErrorNote message={(form.error as Error).message} /></Modal>;
  const f = form.data!;
  const result = f.result;
  const editing = f.canEdit;
  const scores = f.criteria.map((c) => ({ criterionId: c.id, score: draft[c.id]!.score === '' ? null : Number(draft[c.id]!.score), outcome: draft[c.id]!.outcome, comment: draft[c.id]!.comment || undefined }));
  const preview = assessmentOutcome(f.criteria, scores, f.passMarkPct);
  const reviewable = can('assessment.review') && result?.status === 'submitted';
  const ownSubmission = !!result?.submittedById && result.submittedById === me?.id;

  const saveDraft = async (thenSubmit: boolean) => {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const saved = await api.put<{ id: string }>(`/enrolments/${row.enrolmentId}/assessment`, { scores, trainerComment: comment || undefined });
      if (thenSubmit) {
        const r = await api.post<{ outcome: string }>(`/results/${saved.id}/submit`);
        toast('success', `Submitted for review (${r.outcome === 'pass' ? 'pass' : 'fail'})`);
      } else toast('success', 'Draft saved');
      await refresh();
      onClose();
    } catch (e) {
      const x = e as ApiError;
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(x.fields ?? {})) {
        const m = /^scores\.(\d+)/.exec(k);
        if (m) mapped[f.criteria[Number(m[1])]!.id] = v;
      }
      setErrors(mapped);
      setFormError(x.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/results/${result!.id}/approve`);
      await refresh();
      toast('success', 'Result approved and released');
      onClose();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={!decision}
        wide
        onClose={onClose}
        title={`${editing ? 'Assess' : 'Assessment'}: ${f.candidateName}`}
        footer={
          editing ? (
            <>
              <button className="btn-secondary mr-auto" onClick={onClose}>Cancel</button>
              <button className="btn-secondary" disabled={busy} onClick={() => void saveDraft(false)}>Save draft</button>
              <button className="btn-primary" disabled={busy} onClick={() => void saveDraft(true)}>Submit for review</button>
            </>
          ) : reviewable ? (
            <>
              <button className="btn-secondary mr-auto text-brand" disabled={busy || ownSubmission} onClick={() => setDecision('reject')}>Reject</button>
              <button className="btn-secondary" disabled={busy || ownSubmission} onClick={() => setDecision('return')}>Return for correction</button>
              <button className="btn-primary" disabled={busy || ownSubmission} onClick={() => void approve()}>Approve</button>
            </>
          ) : (
            <button className="btn-primary" onClick={onClose}>Close</button>
          )
        }
      >
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1">
          {formError && <ErrorNote message={formError} />}
          {result?.status === 'returned' && result.reviewReason && (
            <p className="rounded-lg bg-brand-tint px-4 py-3 text-sm text-brand">Returned by {result.reviewedByName}: {result.reviewReason}</p>
          )}
          {reviewable && ownSubmission && <p className="rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">You submitted this result, so another reviewer must decide on it.</p>}
          {result && !editing && (
            <p className="text-sm text-muted">
              Submitted by {result.submittedByName ?? '—'}
              {result.reviewedByName && result.status === 'approved' ? `. Approved by ${result.reviewedByName}.` : '.'}
            </p>
          )}
          <table className="w-full text-left text-sm">
            <thead className="text-[13px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Criterion</th>
                <th className="w-24 py-2 pr-3 font-medium">Marks</th>
                <th className="w-36 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {f.criteria.map((c) => {
                const d = draft[c.id]!;
                return (
                  <tr key={c.id}>
                    <td className="py-3 pr-3">
                      <p className="font-medium">
                        {c.label}
                        {c.required && <span className="ml-2 rounded bg-brand-tint px-1.5 py-0.5 text-xs font-semibold text-brand">Required</span>}
                      </p>
                      {editing ? (
                        <>
                          <label className="sr-only" htmlFor={`cm-${c.id}`}>Comment on {c.label}</label>
                          <input id={`cm-${c.id}`} className="field-input mt-2 h-9 text-sm" placeholder="Comment (optional)" value={d.comment} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, comment: e.target.value } })} />
                        </>
                      ) : (
                        d.comment && <p className="mt-1 text-[13px] text-muted">{d.comment}</p>
                      )}
                      {errors[c.id] && <p className="field-error">{errors[c.id]}</p>}
                    </td>
                    <td className="py-3 pr-3">
                      {editing ? (
                        <>
                          <label className="sr-only" htmlFor={`sc-${c.id}`}>Marks for {c.label}, out of {c.maxScore}</label>
                          <div className="flex items-center gap-1">
                            <input id={`sc-${c.id}`} type="number" min={0} max={c.maxScore} inputMode="numeric" disabled={d.outcome === 'not_assessed'} className="field-input h-9 w-16 px-2" value={d.score} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, score: e.target.value } })} />
                            <span className="text-[13px] text-muted">/{c.maxScore}</span>
                          </div>
                        </>
                      ) : (
                        <span className="tabular-nums">{d.outcome === 'not_assessed' ? '—' : `${d.score}/${c.maxScore}`}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {editing ? (
                        <>
                          <label className="sr-only" htmlFor={`oc-${c.id}`}>Result for {c.label}</label>
                          <select id={`oc-${c.id}`} className="field-input h-9 text-sm" value={d.outcome} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, outcome: e.target.value as Draft[string]['outcome'], score: e.target.value === 'not_assessed' ? '' : d.score } })}>
                            <option value="not_assessed">Not assessed</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                          </select>
                        </>
                      ) : (
                        <span>{d.outcome === 'not_assessed' ? 'Not assessed' : d.outcome === 'pass' ? 'Pass' : 'Fail'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-4 py-3 text-sm">
            <span>
              <span className="font-semibold">{preview.total} of {preview.max} marks</span> ({preview.pct}%). Pass mark {f.passMarkPct}%.
            </span>
            <span className={`rounded-md px-2 py-0.5 font-bold ${preview.outcome === 'pass' ? 'bg-success-tint text-success' : 'bg-brand-tint text-brand'}`}>
              {editing ? 'Would be: ' : ''}
              {preview.outcome === 'pass' ? 'Pass' : 'Fail'}
            </span>
          </div>
          {preview.requiredFailed.length > 0 && <p className="text-[13px] text-muted">Every required criterion must be passed to pass the course.</p>}
          {editing ? (
            <Field label="Overall comment (optional)" htmlFor="tr-comment">
              <textarea id="tr-comment" rows={2} className="field-input h-auto py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          ) : (
            comment && <p className="text-sm"><span className="font-medium">Trainer’s comment:</span> {comment}</p>
          )}
          {editing && <p className="text-[13px] text-muted">After you submit, the result is locked until VTA approves it or returns it to you.</p>}
        </div>
      </Modal>
      {decision && (
        <ReasonModal
          title={decision === 'return' ? 'Return for correction' : `Reject ${f.candidateName}’s result?`}
          label={decision === 'return' ? 'What should the trainer correct?' : 'Why is it rejected?'}
          action={decision === 'return' ? 'Return to trainer' : 'Reject result'}
          intro={decision === 'reject' ? 'The result is voided. The trainer will need to assess the candidate again.' : undefined}
          onClose={() => setDecision(null)}
          onSubmit={(reason) =>
            api
              .post(`/results/${result!.id}/${decision}`, { reason })
              .then(refresh)
              .then(() => {
                toast('success', decision === 'return' ? 'Returned to the trainer' : 'Result rejected');
                onClose();
              })
          }
        />
      )}
    </>
  );
}
