import { useQuery } from '@tanstack/react-query';
import { SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';
import { AlertTriangle, ArrowLeft, Award, CheckCircle2, Hourglass, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { courseImage } from '../public/Courses';
import { EmptyState, ErrorNote, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { fmtDate } from './attendance';
import type { LearnerResult, LearningItem } from './types';

/** Attendance so far against the course's requirement, in words and a bar (never colour alone). */
export function AttendanceMeter({ item }: { item: LearningItem }) {
  const a = item.attendance;
  if (!a.sessionsHeld) return <p className="text-sm text-muted">{t('No sessions held yet.')}</p>;
  const pct = a.pct ?? 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{t('Attendance {pct}', { pct: a.pct === null ? '–' : `${a.pct}%` })}</span>
        <span className="text-muted">
          {t('{done} of {total} sessions, {need}% needed', { done: a.present + a.late, total: a.present + a.late + a.absent, need: a.thresholdPct })}
        </span>
      </div>
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
        <div className={`h-full rounded-full ${a.belowThreshold ? 'bg-brand' : 'bg-success'}`} style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${a.thresholdPct}%` }} />
      </div>
      {a.belowThreshold && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-brand">
          <AlertTriangle className="size-3.5" aria-hidden />
          {t('Below the attendance needed to complete. Talk to your trainer.')}
        </p>
      )}
    </div>
  );
}

const ASSESSMENT = (): Record<LearningItem['assessment']['state'], string> => ({
  not_assessed: t('Not assessed yet'),
  in_review: t('Assessment in progress'),
  released: t('Result available'),
});

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
const TABS = [{ key: 'ongoing' }, { key: 'completed' }, { key: 'all' }] as const;
const TAB_LABEL = (): Record<(typeof TABS)[number]['key'], string> => ({ ongoing: t('Ongoing'), completed: t('Completed'), all: t('All courses') });

/** EE-04 and the brand design of 26 Oct 2026: each course with dates, centre, attendance, assessment and certificate. */
export function LearningPage() {
  const q = useQuery({ queryKey: ['me', 'learning'], queryFn: () => api.get<{ items: LearningItem[] }>('/me/learning') });
  // Career journey courses paid for and waiting for AutoTalent Grid to assign a batch.
  const waiting = useQuery({
    queryKey: ['me', 'bookings'],
    queryFn: () => api.get<{ items: { id: string; status: string; bookedAt: string; course: { id: string; title: string } }[] }>('/me/bookings'),
    select: (d) => d.items.filter((b) => b.status === 'awaiting_batch'),
  });
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
        title={t('My Courses')}
        description={t('Your courses, attendance, assessments and certificates.')}
        actions={
          <Link to="/courses" className="btn-secondary">
            {t('Find a course')}
          </Link>
        }
      />
      {!!waiting.data?.length && (
        <ul className="mb-5 space-y-2">
          {waiting.data.map((b) => (
            <li key={b.id} className="card flex items-start gap-3 border-warning/40 bg-warning-tint/40 px-4 py-3 text-sm">
              <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <Link to={`/courses/${b.course.id}`} className="font-semibold hover:text-brand">
                  {b.course.title}
                </Link>
                <span className="block text-muted">{t('Enrolled on {date}. AutoTalent Grid will assign your training partner and batch, and tell you the dates.', { date: fmtDate(b.bookedAt.slice(0, 10)) })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : (
        <>
          <div role="tablist" aria-label={t('Courses')} className="mb-4 flex gap-2">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={tab === tb.key}
                onClick={() => setTab(tb.key)}
                className={`h-9 rounded-full border px-4 text-sm font-medium ${tab === tb.key ? 'border-[#D7141C] bg-brand-tint text-[#C8101A]' : 'border-line hover:bg-surface'}`}
              >
                {TAB_LABEL()[tb.key]} ({lists[tb.key].length})
              </button>
            ))}
          </div>
          {!shown.length ? (
            <EmptyState
              title={tab === 'completed' ? t('No completed courses yet') : t('No courses here yet')}
              body={t('Find a course and enrol online, or your training centre can enrol you in a batch.')}
              action={
                <Link to="/courses" className="btn-primary">
                  {t('Explore training')}
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
                            <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{SKILL_AREA_LABEL[i.course.skillArea as SkillArea] ? t(SKILL_AREA_LABEL[i.course.skillArea as SkillArea]) : i.course.skillArea}</p>
                            <h2 className="text-lg font-bold">{i.course.title}</h2>
                          </div>
                          {i.enrolmentStatus === 'enrolled' && !isDone(i) ? (
                            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${upcoming ? 'bg-info-tint text-info' : 'bg-success-tint text-success'}`}>{upcoming ? t('Upcoming') : t('Ongoing')}</span>
                          ) : (
                            <StatusBadge status={i.enrolmentStatus} />
                          )}
                        </div>
                        <p className="text-sm text-muted">
                          {t('{batch}, {start} to {end}', { batch: i.batch.name, start: fmtDate(i.batch.startDate), end: fmtDate(i.batch.endDate) })}
                        </p>
                        <p className="text-sm text-muted">
                          {i.centre.name}
                          {i.centre.city ? `, ${i.centre.city}` : ''}
                        </p>
                        {i.enrolmentStatus === 'enrolled' && !isDone(i) && (
                          <div className="mt-3">
                            <div className="flex justify-between text-[13px]">
                              <span className="text-muted">{upcoming ? t('Starts in {n} days', { n: daysUntil(i.batch.startDate) }) : t('Course timeline')}</span>
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
                        <dt className="font-semibold">{t('Attendance')}</dt>
                        <dd className={`text-muted ${a.belowThreshold ? 'font-medium text-brand' : ''}`}>
                          {a.sessionsHeld ? t('{n} / {total} sessions', { n: a.present + a.late, total: a.sessionsHeld }) : t('No sessions yet')}
                          {a.belowThreshold && (
                            <span className="mt-0.5 flex items-center gap-1 text-[12px]">
                              <AlertTriangle className="size-3.5" aria-hidden />
                              {t('Below {pct}%', { pct: a.thresholdPct })}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="px-4 py-3">
                        <dt className="font-semibold">{t('Assessment')}</dt>
                        <dd className="text-muted">
                          {i.assessment.state === 'released' ? (i.assessment.outcome === 'pass' ? t('Passed') : t('Not passed')) : ASSESSMENT()[i.assessment.state]}
                        </dd>
                      </div>
                      <div className="px-4 py-3">
                        <dt className="font-semibold">{t('Certificate')}</dt>
                        <dd className="text-muted">{i.credentialId ? t('Issued') : t('Not yet issued')}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
                      <Link to={`/courses/${i.course.id}`} className="btn-secondary btn-sm">
                        {t('Course details')}
                      </Link>
                      {i.source === 'self' && (
                        <Link to={`/enrol/done/${i.enrolmentId}`} className="btn-secondary btn-sm">
                          {t('Receipt')}
                        </Link>
                      )}
                      {i.assessment.state === 'released' && (
                        <Link to={`/learn/learning/${i.enrolmentId}/result`} className="btn-secondary btn-sm">
                          {t('View result')}
                        </Link>
                      )}
                      {i.credentialId && (
                        <Link to={`/learn/certificates/${i.credentialId}`} className="btn-primary btn-sm">
                          <Award className="size-4" aria-hidden />
                          {t('Certificate')}
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

const OUTCOME_LABEL = () => ({ pass: t('Pass'), fail: t('Not passed'), not_assessed: t('Not assessed') }) as const;

/** EE-05: a released result with the trainer's feedback for each skill. Internal review notes are never shown. */
export function ResultPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['me', 'result', id], queryFn: () => api.get<LearnerResult>(`/me/results/${id}`) });
  return (
    <>
      <Link to="/learn/learning" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t('My Courses')}
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
                  {r.releasedAt ? t('{batch}, {centre}. Released {date}', { batch: r.batch, centre: r.centre, date: fmtDate(r.releasedAt) }) : `${r.batch}, ${r.centre}`}
                </p>
              </header>
              <section className={`card flex flex-wrap items-center gap-4 px-5 py-5 ${r.outcome === 'pass' ? 'border-success' : 'border-brand'}`}>
                {r.outcome === 'pass' ? <CheckCircle2 className="size-9 text-success" aria-hidden /> : <XCircle className="size-9 text-brand" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold">{r.outcome === 'pass' ? t('Passed') : t('Not passed')}</p>
                  <p className="text-sm text-muted">
                    {t('{score} of {max} marks ({pct}%). Pass mark {pass}% and every required skill passed.', { score: r.totalScore, max: r.maxScore, pct: r.pct, pass: r.passMarkPct })}
                  </p>
                </div>
              </section>
              {r.feedback && (
                <section className="card mt-4 px-5 py-4">
                  <h2 className="text-sm font-semibold text-muted">{t('Trainer feedback')}</h2>
                  <p className="mt-1 whitespace-pre-line">{r.feedback}</p>
                </section>
              )}
              <section className="card mt-4 overflow-hidden">
                <h2 className="border-b border-line px-5 py-3 font-semibold">{t('Skills assessed')}</h2>
                <ul className="divide-y divide-line">
                  {r.criteria.map((c) => (
                    <li key={c.label} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {c.label}
                          {c.required && <span className="ml-1.5 text-[12px] font-normal text-muted">{t('(required)')}</span>}
                        </span>
                        <span className="text-sm">
                          <span className="font-semibold">{c.score ?? 0}</span>/{c.maxScore}, {OUTCOME_LABEL()[c.outcome]}
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
