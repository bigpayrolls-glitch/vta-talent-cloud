import { useQuery } from '@tanstack/react-query';
import { SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';
import { AlertTriangle, ArrowLeft, Award, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { courseImage } from '../public/Courses';
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

/** Share of the batch's dates that have passed (0 before it starts, 100 after it ends). */
function timelinePct(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00+05:30`).getTime();
  const e = new Date(`${end}T23:59:59+05:30`).getTime();
  return Math.max(0, Math.min(100, Math.round(((Date.now() - s) / (e - s)) * 100)));
}
const daysUntil = (d: string) => Math.ceil((new Date(`${d}T00:00:00+05:30`).getTime() - Date.now()) / 86_400_000);
/** Finished: completed or not, the batch closed, or its end date has passed. */
const isDone = (i: LearningItem) =>
  i.enrolmentStatus === 'completed' || i.enrolmentStatus === 'not_completed' || i.batch.status === 'completed' || new Date(`${i.batch.endDate}T23:59:59+05:30`).getTime() < Date.now();
const TABS = [
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All courses' },
] as const;

/** EE-04 and the brand design of 26 Oct 2026: each course with dates, centre, attendance, assessment and certificate. */
export function LearningPage() {
  const q = useQuery({ queryKey: ['me', 'learning'], queryFn: () => api.get<{ items: LearningItem[] }>('/me/learning') });
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('ongoing');
  const items = q.data?.items ?? [];
  const lists = {
    ongoing: items.filter((i) => i.enrolmentStatus === 'enrolled' && !isDone(i)),
    completed: items.filter(isDone),
    all: items,
  };
  const shown = lists[tab];
  return (
    <>
      <PageHeader
        title="My Courses"
        description="Your courses, attendance, assessments and certificates."
        actions={
          <Link to="/courses" className="btn-secondary">
            Find a course
          </Link>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : (
        <>
          <div role="tablist" aria-label="Courses" className="mb-4 flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`h-9 rounded-full border px-4 text-sm font-medium ${tab === t.key ? 'border-[#D7141C] bg-brand-tint text-[#C8101A]' : 'border-line hover:bg-surface'}`}
              >
                {t.label} ({lists[t.key].length})
              </button>
            ))}
          </div>
          {!shown.length ? (
            <EmptyState
              title={tab === 'completed' ? 'No completed courses yet' : 'No courses here yet'}
              body="Find a course and enrol online, or your training centre can enrol you in a batch."
              action={
                <Link to="/courses" className="btn-primary">
                  Explore training
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-4">
              {shown.map((i) => {
                const pct = timelinePct(i.batch.startDate, i.batch.endDate);
                const upcoming = daysUntil(i.batch.startDate) > 0;
                const a = i.attendance;
                return (
                  <li key={i.enrolmentId} className="card overflow-hidden">
                    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row">
                      <img src={courseImage(i.course.skillArea)} alt="" className="h-28 w-full shrink-0 rounded-lg object-cover sm:h-24 sm:w-40" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{SKILL_AREA_LABEL[i.course.skillArea as SkillArea] ?? i.course.skillArea}</p>
                            <h2 className="text-lg font-bold">{i.course.title}</h2>
                          </div>
                          {i.enrolmentStatus === 'enrolled' && !isDone(i) ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${upcoming ? 'bg-info-tint text-info' : 'bg-success-tint text-success'}`}>{upcoming ? 'Upcoming' : 'Ongoing'}</span>
                          ) : (
                            <StatusBadge status={i.enrolmentStatus} />
                          )}
                        </div>
                        <p className="text-sm text-muted">
                          {i.batch.name}, {fmtDate(i.batch.startDate)} to {fmtDate(i.batch.endDate)}
                        </p>
                        <p className="text-sm text-muted">
                          {i.centre.name}
                          {i.centre.city ? `, ${i.centre.city}` : ''}
                        </p>
                        {i.enrolmentStatus === 'enrolled' && !isDone(i) && (
                          <div className="mt-3">
                            <div className="flex justify-between text-[13px]">
                              <span className="text-muted">{upcoming ? `Starts in ${daysUntil(i.batch.startDate)} days` : 'Course timeline'}</span>
                              <span className="font-semibold">{pct}%</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
                              <div className="h-full rounded-full bg-[#D7141C]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-3 divide-x divide-line border-t border-line text-sm">
                      <div className="px-4 py-3">
                        <dt className="font-semibold">Attendance</dt>
                        <dd className={`text-muted ${a.belowThreshold ? 'font-medium text-brand' : ''}`}>
                          {a.sessionsHeld ? `${a.present + a.late} / ${a.sessionsHeld} sessions` : 'No sessions yet'}
                          {a.belowThreshold && (
                            <span className="mt-0.5 flex items-center gap-1 text-[12px]">
                              <AlertTriangle className="size-3.5" aria-hidden />
                              Below {a.thresholdPct}%
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="px-4 py-3">
                        <dt className="font-semibold">Assessment</dt>
                        <dd className="text-muted">
                          {i.assessment.state === 'released' ? (i.assessment.outcome === 'pass' ? 'Passed' : 'Not passed') : ASSESSMENT[i.assessment.state]}
                        </dd>
                      </div>
                      <div className="px-4 py-3">
                        <dt className="font-semibold">Certificate</dt>
                        <dd className="text-muted">{i.credentialId ? 'Issued' : 'Not yet issued'}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
                      <Link to={`/courses/${i.course.id}`} className="btn-secondary btn-sm">
                        Course details
                      </Link>
                      {i.source === 'self' && (
                        <Link to={`/enrol/done/${i.enrolmentId}`} className="btn-secondary btn-sm">
                          Receipt
                        </Link>
                      )}
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
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
        My Courses
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
