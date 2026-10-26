import type { Metric } from '@vta/shared';
import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import { todayIst } from '../../lib/dates.js';

const ACTIVE_WINDOW_DAYS = 14;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * Cohort figures for a set of batches, using the definitions in requirements §17. Every rate carries its denominator,
 * and offers are kept apart from joinings. Employment counts only applications made after the person enrolled.
 */
export async function cohortMetrics(db: DB, batchIds: string[], target?: number): Promise<{ metrics: Metric[]; asOf: string }> {
  const asOf = new Date().toISOString();
  const metric = (m: Metric) => m;
  if (!batchIds.length) {
    return {
      asOf,
      metrics: [
        ...(target ? [metric({ key: 'target', label: 'Target', value: target, definition: 'Agreed number of people the programme aims to train.', basis: 'target' })] : []),
        metric({ key: 'enrolled', label: 'Enrolled', value: 0, definition: 'No batches are linked yet.', basis: 'actual' }),
      ],
    };
  }
  const today = todayIst();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - (ACTIVE_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

  const { rows } = await sql<{
    enrolments: string;
    people: string;
    withdrawn: string;
    active: string;
    ended: string;
    completed: string;
    completed_people: string;
    assessed: string;
    passed: string;
    certified: string;
    offers: string;
    joined: string;
    joined_verified: string;
  }>`
    with cohort as (
      select e.id, e.candidate_id, e.status, e.enrolled_at, b.status as batch_status, b.id as batch_id
      from enrolments e join batches b on b.id = e.batch_id
      where e.batch_id in (${sql.join(batchIds)})
    ),
    live as (select * from cohort where status <> 'withdrawn'),
    apps as (
      select distinct on (a.candidate_id) a.candidate_id, a.status, a.outcome_verification
      from job_applications a join live c on c.candidate_id = a.candidate_id and a.applied_at >= c.enrolled_at
      order by a.candidate_id,
        case when a.status = 'joined' and a.outcome_verification = 'verified' then 0 when a.status = 'joined' then 1 when a.status in ('offer','not_joined') then 2 else 3 end
    )
    select
      (select count(*) from live) as enrolments,
      (select count(distinct candidate_id) from live) as people,
      (select count(*) from cohort where status = 'withdrawn') as withdrawn,
      (select count(*) from live c where c.batch_status = 'active' and exists (
        select 1 from attendance_sessions s join attendance_records r on r.session_id = s.id
        where s.batch_id = c.batch_id and r.candidate_id = c.candidate_id and r.status in ('present','late') and s.session_date >= ${since}::date)) as active,
      (select count(*) from live where batch_status = 'completed') as ended,
      (select count(*) from live where status = 'completed') as completed,
      (select count(distinct candidate_id) from live where status = 'completed') as completed_people,
      (select count(*) from live c join assessment_results ar on ar.enrolment_id = c.id and ar.status = 'approved') as assessed,
      (select count(*) from live c join assessment_results ar on ar.enrolment_id = c.id and ar.status = 'approved' and ar.outcome = 'pass') as passed,
      (select count(*) from live c join credentials cr on cr.enrolment_id = c.id and cr.status = 'active') as certified,
      (select count(*) from apps where status in ('offer','joined','not_joined')) as offers,
      (select count(*) from apps where status = 'joined') as joined,
      (select count(*) from apps where status = 'joined' and outcome_verification = 'verified') as joined_verified
  `.execute(db);
  const r = Object.fromEntries(Object.entries(rows[0]!).map(([k, v]) => [k, Number(v)])) as Record<keyof (typeof rows)[0], number>;

  const metrics: Metric[] = [
    ...(target
      ? [metric({ key: 'target', label: 'Target', value: target, definition: 'Agreed number of people the programme aims to train (a target, not an actual).', basis: 'target' })]
      : []),
    metric({
      key: 'enrolled',
      label: 'Enrolled',
      value: r.enrolments,
      definition: `Candidate-to-batch enrolments, not counting withdrawals (${r.withdrawn} withdrawn). One person in two batches counts twice; ${r.people} different people.`,
      basis: 'actual',
      ...(target ? { denominator: { label: 'target', value: target } } : {}),
    }),
    metric({
      key: 'active',
      label: 'Active learners',
      value: r.active,
      definition: `Enrolled in a running batch and marked present or late at least once in the last ${ACTIVE_WINDOW_DAYS} days (to ${today}).`,
      basis: 'actual',
    }),
    metric({
      key: 'completed',
      label: 'Completed',
      value: r.completed,
      denominator: { label: 'enrolments in finished batches', value: r.ended },
      definition: "Met the course's attendance requirement when the batch was marked completed. Rate = completed ÷ enrolments in finished batches.",
      basis: 'actual',
    }),
    metric({ key: 'assessed', label: 'Assessed', value: r.assessed, definition: 'Enrolments with an assessment result approved by an authorised AutoTalent Grid reviewer.', basis: 'actual' }),
    metric({
      key: 'passed',
      label: 'Passed',
      value: r.passed,
      denominator: { label: 'assessed', value: r.assessed },
      definition: 'Marked pass by an authorised reviewer. Rate = passed ÷ assessed.',
      basis: 'actual',
    }),
    metric({ key: 'certified', label: 'Certified', value: r.certified, definition: 'AutoTalent Grid course completion records with active status. Revoked or replaced records are not counted.', basis: 'actual' }),
    metric({
      key: 'offers',
      label: 'Job offers',
      value: r.offers,
      definition: 'People who received a job offer through AutoTalent Grid after enrolling (as recorded by employers). An offer is not a joining.',
      basis: 'employer_reported',
    }),
    metric({ key: 'joined', label: 'Joined (employer-reported)', value: r.joined, definition: 'People an employer recorded as having joined, after enrolling.', basis: 'employer_reported' }),
    metric({
      key: 'joined_verified',
      label: 'Joined (AutoTalent Grid-verified)',
      value: r.joined_verified,
      denominator: { label: 'people who completed', value: r.completed_people },
      definition: 'Joinings confirmed by AutoTalent Grid. Placement rate = verified joinings ÷ people who completed (the eligible cohort).',
      basis: 'vta_verified',
    }),
  ];
  return { asOf, metrics };
}

export const metricRate = (m: Metric) => (m.denominator ? pct(m.value, m.denominator.value) : null);
