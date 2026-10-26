import { useQuery } from '@tanstack/react-query';
import { SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';
import { AlertTriangle, ArrowLeft, Award, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorNote, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDate } from './attendance';
import type { LearnerResult, LearningItem } from './types';

/** Attendance so far against the course's requirement, in words and a bar (never colour alone). */
export function AttendanceMeter({ item }: { item: LearningItem }) {
  const a = item.attendance;
  if (!a.sessionsHeld) return <p className="text-sm text-muted">No sessions held yet.</p>;
  const pct = a.pct ?? 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">Attendance {a.pct === null ? '–' : `${a.pct}%`}</span>
        <span className="text-muted">
          {a.present + a.late} of {a.present + a.late + a.absent} sessions, {a.thresholdPct}% needed
        </span>
      </div>
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
        <div className={`h-full rounded-full ${a.belowThreshold ? 'bg-brand' : 'bg-success'}`} style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${a.thresholdPct}%` }} />
      </div>
      {a.belowThreshold && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-brand">
          <AlertTriangle className="size-3.5" aria-hidden />
          Below the attendance needed to complete. Talk to your trainer.
        </p>
      )}
    </div>
  );
}

const ASSESSMENT: Record<LearningItem['assessment']['state'], string> = {
  not_assessed: 'Not assessed yet',
  in_review: 'Assessment in progress',
  released: 'Result available',
};

/** EE-04: each course with dates, centre, attendance and where the assessment stands. */
export function LearningPage() {
  const q = useQuery({ queryKey: ['me', 'learning'], queryFn: () => api.get<{ items: LearningItem[] }>('/me/learning') });
  return (
    <>
      <PageHeader title="My learning" description="Your courses, attendance and results." />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <EmptyState title="No courses yet" body="When your training centre enrols you in a batch, it appears here." />
      ) : (
        <ul className="grid gap-4">
          {q.data!.items.map((i) => (
            <li key={i.enrolmentId} className="card px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{SKILL_AREA_LABEL[i.course.skillArea as SkillArea] ?? i.course.skillArea}</p>
                  <h2 className="text-lg font-bold">{i.course.title}</h2>
                  <p className="text-sm text-muted">
                    {i.batch.name}, {i.centre.name}
                    {i.centre.city ? `, ${i.centre.city}` : ''}
                  </p>
                  <p className="text-sm text-muted">
                    {fmtDate(i.batch.startDate)} to {fmtDate(i.batch.endDate)}
                  </p>
                </div>
                <StatusBadge status={i.enrolmentStatus} />
              </div>
              <div className="mt-4">
                <AttendanceMeter item={i} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  {i.assessment.state === 'released' ? (
                    i.assessment.outcome === 'pass' ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-brand" aria-hidden />
                  ) : (
                    <Clock className="size-4 text-muted" aria-hidden />
                  )}
                  {i.assessment.state === 'released' ? `Assessment: ${i.assessment.outcome === 'pass' ? 'Passed' : 'Not passed'}` : ASSESSMENT[i.assessment.state]}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {i.assessment.state === 'released' && (
                    <Link to={`/learn/learning/${i.enrolmentId}/result`} className="btn-secondary btn-sm">
                      View result
                    </Link>
                  )}
                  {i.credentialId && (
                    <Link to={`/learn/certificates/${i.credentialId}`} className="btn-primary btn-sm">
                      <Award className="size-4" aria-hidden />
                      Certificate
                    </Link>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const OUTCOME_LABEL = { pass: 'Pass', fail: 'Not passed', not_assessed: 'Not assessed' } as const;

/** EE-05: a released result with the trainer's feedback for each skill. Internal review notes are never shown. */
export function ResultPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['me', 'result', id], queryFn: () => api.get<LearnerResult>(`/me/results/${id}`) });
  return (
    <>
      <Link to="/learn/learning" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        My learning
      </Link>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <div className="mt-4">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      ) : (
        (() => {
          const r = q.data!;
          return (
            <>
              <header className="mb-5 mt-3">
                <h1 className="text-2xl font-bold tracking-tight">{r.course}</h1>
                <p className="mt-1 text-muted">
                  {r.batch}, {r.centre}
                  {r.releasedAt ? `. Released ${fmtDate(r.releasedAt)}` : ''}
                </p>
              </header>
              <section className={`card flex flex-wrap items-center gap-4 px-5 py-5 ${r.outcome === 'pass' ? 'border-success' : 'border-brand'}`}>
                {r.outcome === 'pass' ? <CheckCircle2 className="size-9 text-success" aria-hidden /> : <XCircle className="size-9 text-brand" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold">{r.outcome === 'pass' ? 'Passed' : 'Not passed'}</p>
                  <p className="text-sm text-muted">
                    {r.totalScore} of {r.maxScore} marks ({r.pct}%). Pass mark {r.passMarkPct}% and every required skill passed.
                  </p>
                </div>
              </section>
              {r.feedback && (
                <section className="card mt-4 px-5 py-4">
                  <h2 className="text-sm font-semibold text-muted">Trainer feedback</h2>
                  <p className="mt-1 whitespace-pre-line">{r.feedback}</p>
                </section>
              )}
              <section className="card mt-4 overflow-hidden">
                <h2 className="border-b border-line px-5 py-3 font-semibold">Skills assessed</h2>
                <ul className="divide-y divide-line">
                  {r.criteria.map((c) => (
                    <li key={c.label} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {c.label}
                          {c.required && <span className="ml-1.5 text-[12px] font-normal text-muted">(required)</span>}
                        </span>
                        <span className="text-sm">
                          <span className="font-semibold">{c.score ?? 0}</span>/{c.maxScore}, {OUTCOME_LABEL[c.outcome]}
                        </span>
                      </div>
                      {c.comment && <p className="mt-1 text-sm text-muted">{c.comment}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          );
        })()
      )}
    </>
  );
}
