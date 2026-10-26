import { assessmentOutcome, assessmentSchema, reasonSchema, RESULT_STATUSES, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import { newId } from '../../lib/crypto.js';
import { forbidden, invalid, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { trainerBatch, visibleBatch } from './common.js';

const idParam = z.object({ id: uuidSchema });

async function courseRules(db: DB, courseId: string) {
  const course = await db.selectFrom('courses').select(['pass_mark_pct', 'title']).where('id', '=', courseId).executeTakeFirstOrThrow();
  const criteria = await db.selectFrom('assessment_criteria').select(['id', 'label', 'max_score', 'required']).where('course_id', '=', courseId).orderBy('sort_order').execute();
  return { passMarkPct: course.pass_mark_pct, criteria: criteria.map((c) => ({ id: c.id, label: c.label, maxScore: c.max_score, required: c.required })) };
}

/** Loads an enrolment with its batch; the actor must be able to see the batch. */
async function visibleEnrolment(db: DB, req: FastifyRequest, enrolmentId: string) {
  const e = await db.selectFrom('enrolments').selectAll().where('id', '=', enrolmentId).executeTakeFirst();
  if (!e) throw notFound('Enrolment');
  const batch = await visibleBatch(db, req, e.batch_id);
  return { enrolment: e, batch };
}

async function liveResult(db: DB, enrolmentId: string) {
  return db.selectFrom('assessment_results').selectAll().where('enrolment_id', '=', enrolmentId).where('status', '!=', 'rejected').executeTakeFirst();
}

async function resultDto(db: DB, resultId: string) {
  const r = await db
    .selectFrom('assessment_results as r')
    .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
    .innerJoin('users as u', 'u.id', 'e.candidate_id')
    .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
    .innerJoin('batches as b', 'b.id', 'e.batch_id')
    .innerJoin('courses as c', 'c.id', 'b.course_id')
    .leftJoin('users as sub', 'sub.id', 'r.submitted_by')
    .leftJoin('users as rev', 'rev.id', 'r.reviewed_by')
    .selectAll('r')
    .select(['u.id as candidate_id', 'u.name as candidate_name', 'cp.candidate_code', 'b.id as batch_id', 'b.name as batch_name', 'c.id as course_id', 'c.title as course_title', 'c.pass_mark_pct', 'sub.name as submitted_by_name', 'rev.name as reviewed_by_name'])
    .where('r.id', '=', resultId)
    .executeTakeFirstOrThrow();
  const scores = await db.selectFrom('assessment_scores').selectAll().where('result_id', '=', resultId).execute();
  const rules = await courseRules(db, r.course_id);
  return {
    id: r.id,
    enrolmentId: r.enrolment_id,
    status: r.status,
    totalScore: r.total_score,
    maxScore: r.max_score,
    pct: r.max_score ? Math.round((r.total_score / r.max_score) * 1000) / 10 : 0,
    outcome: r.outcome,
    passMarkPct: r.pass_mark_pct,
    trainerComment: r.trainer_comment,
    submittedAt: iso(r.submitted_at),
    submittedById: r.submitted_by,
    submittedByName: r.submitted_by_name,
    reviewedAt: iso(r.reviewed_at),
    reviewedByName: r.reviewed_by_name,
    reviewReason: r.review_reason,
    releasedAt: iso(r.released_at),
    candidate: { id: r.candidate_id, name: r.candidate_name, code: r.candidate_code },
    batch: { id: r.batch_id, name: r.batch_name },
    course: { id: r.course_id, title: r.course_title },
    criteria: rules.criteria.map((c) => {
      const s = scores.find((x) => x.criterion_id === c.id);
      return { ...c, score: s?.score ?? null, outcome: s?.outcome ?? 'not_assessed', comment: s?.comment ?? null };
    }),
  };
}

/** R-03 to R-04: practical assessment, submission and VTA review. */
export const assessmentRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** One row per enrolled candidate with their live result's status. */
  app.get('/batches/:id/assessments', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await visibleBatch(db, req, id);
    const rows = await db
      .selectFrom('enrolments as e')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .leftJoin('assessment_results as r', (j) => j.onRef('r.enrolment_id', '=', 'e.id').on('r.status', '!=', 'rejected'))
      .select(['e.id as enrolment_id', 'e.status as enrolment_status', 'u.id as candidate_id', 'u.name', 'cp.candidate_code', 'r.id as result_id', 'r.status', 'r.total_score', 'r.max_score', 'r.outcome', 'r.submitted_at', 'r.review_reason'])
      .where('e.batch_id', '=', id)
      .where('e.status', '!=', 'withdrawn')
      .orderBy('u.name')
      .execute();
    const canRecord = batch.trainer_id === req.actor!.userId && req.actor!.assignments.some((a) => a.role === 'trainer' && a.centreId === batch.centre_id) && (batch.status === 'active' || batch.status === 'completed');
    return {
      canRecord,
      items: rows.map((r) => ({
        enrolmentId: r.enrolment_id,
        candidateId: r.candidate_id,
        name: r.name,
        code: r.candidate_code,
        resultId: r.result_id,
        status: r.status ?? 'not_started',
        totalScore: r.total_score,
        maxScore: r.max_score,
        outcome: r.status === 'submitted' || r.status === 'approved' ? r.outcome : null,
        submittedAt: iso(r.submitted_at),
        returnReason: r.status === 'returned' ? r.review_reason : null,
      })),
    };
  });

  /** The assessment form for one candidate: course criteria plus the live result, if any. */
  app.get('/enrolments/:id/assessment', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { enrolment, batch } = await visibleEnrolment(db, req, id);
    const rules = await courseRules(db, batch.course_id);
    const live = await liveResult(db, id);
    const candidate = await db.selectFrom('users').select(['name']).where('id', '=', enrolment.candidate_id).executeTakeFirstOrThrow();
    return {
      enrolmentId: id,
      candidateName: candidate.name,
      batch: { id: batch.id, name: batch.name, status: batch.status },
      passMarkPct: rules.passMarkPct,
      criteria: rules.criteria,
      result: live ? await resultDto(db, live.id) : null,
      canEdit:
        batch.trainer_id === req.actor!.userId &&
        req.actor!.assignments.some((a) => a.role === 'trainer' && a.centreId === batch.centre_id) &&
        (batch.status === 'active' || batch.status === 'completed') &&
        enrolment.status !== 'withdrawn' &&
        (!live || live.status === 'draft' || live.status === 'returned'),
    };
  });

  /** Save a draft (or a corrected result after it was returned). Trainer of the batch only. */
  app.put('/enrolments/:id/assessment', { config: { permission: 'assessment.record' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(assessmentSchema, req.body);
    const e = await db.selectFrom('enrolments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!e) throw notFound('Enrolment');
    const batch = await trainerBatch(db, req, e.batch_id);
    if (batch.status !== 'active' && batch.status !== 'completed') throw invalid(`Assessments cannot be recorded in a ${batch.status} batch.`);
    if (e.status === 'withdrawn') throw invalid('This candidate has been withdrawn from the batch.');
    const rules = await courseRules(db, batch.course_id);
    const fields: Record<string, string> = {};
    for (const [i, s] of body.scores.entries()) {
      const c = rules.criteria.find((x) => x.id === s.criterionId);
      if (!c) fields[`scores.${i}`] = 'Not a criterion of this course';
      else if (s.outcome !== 'not_assessed' && (s.score === null || s.score === undefined)) fields[`scores.${i}.score`] = 'Enter the marks';
      else if (s.score != null && s.score > c.maxScore) fields[`scores.${i}.score`] = `At most ${c.maxScore}`;
    }
    if (Object.keys(fields).length) throw invalid('Some marks need attention', fields);
    const { total, max, outcome } = assessmentOutcome(rules.criteria, body.scores, rules.passMarkPct);

    return db.transaction().execute(async (trx) => {
      let live = await trx.selectFrom('assessment_results').selectAll().where('enrolment_id', '=', id).where('status', '!=', 'rejected').forUpdate().executeTakeFirst();
      if (live && live.status !== 'draft' && live.status !== 'returned') throw invalid('This result has been submitted and cannot be changed unless VTA returns it for correction.');
      if (!live) {
        const rid = newId();
        await trx
          .insertInto('assessment_results')
          .values({ id: rid, enrolment_id: id, status: 'draft', total_score: total, max_score: max, outcome, trainer_comment: body.trainerComment ?? null, recorded_by: req.actor!.userId })
          .execute();
        live = await trx.selectFrom('assessment_results').selectAll().where('id', '=', rid).executeTakeFirstOrThrow();
      } else {
        await trx
          .updateTable('assessment_results')
          .set({ total_score: total, max_score: max, outcome, trainer_comment: body.trainerComment ?? null, updated_at: new Date() })
          .where('id', '=', live.id)
          .execute();
      }
      await trx.deleteFrom('assessment_scores').where('result_id', '=', live.id).execute();
      await trx
        .insertInto('assessment_scores')
        .values(body.scores.map((s) => ({ id: newId(), result_id: live!.id, criterion_id: s.criterionId, score: s.outcome === 'not_assessed' ? null : (s.score ?? null), outcome: s.outcome, comment: s.comment || null })))
        .execute();
      await audit(trx, auditCtx(req), { action: 'assessment.saved', entityType: 'batch', entityId: batch.id, after: { resultId: live.id, candidateId: e.candidate_id, total, max } });
      return { id: live.id, status: live.status, totalScore: total, maxScore: max };
    });
  });

  /** TR-06: submit for review. Every required criterion must be assessed. Read-only for the trainer afterwards. */
  app.post('/results/:id/submit', { config: { permission: 'assessment.record' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await db
      .selectFrom('assessment_results as r')
      .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
      .select(['r.id', 'r.status', 'e.batch_id', 'e.candidate_id'])
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Result');
    const batch = await trainerBatch(db, req, r.batch_id);
    if (r.status !== 'draft' && r.status !== 'returned') throw invalid(`A ${r.status} result cannot be submitted.`);
    const rules = await courseRules(db, batch.course_id);
    const scores = await db.selectFrom('assessment_scores').select(['criterion_id', 'score', 'outcome']).where('result_id', '=', id).execute();
    const missing = rules.criteria.filter((c) => c.required && (scores.find((s) => s.criterion_id === c.id)?.outcome ?? 'not_assessed') === 'not_assessed');
    if (missing.length) throw invalid(`Assess every required criterion before submitting: ${missing.map((m) => m.label).join(', ')}.`);
    const result = assessmentOutcome(rules.criteria, scores.map((s) => ({ criterionId: s.criterion_id, score: s.score, outcome: s.outcome })), rules.passMarkPct);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('assessment_results')
        .set({ status: 'submitted', outcome: result.outcome, total_score: result.total, max_score: result.max, submitted_by: req.actor!.userId, submitted_at: new Date(), review_reason: null, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await audit(trx, auditCtx(req), {
        action: 'assessment.submitted',
        entityType: 'batch',
        entityId: batch.id,
        before: { status: r.status },
        after: { resultId: id, candidateId: r.candidate_id, status: 'submitted', outcome: result.outcome, total: result.total, max: result.max },
      });
    });
    return { id, status: 'submitted', outcome: result.outcome };
  });

  app.get('/results/:id', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await db.selectFrom('assessment_results').select(['enrolment_id']).where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Result');
    await visibleEnrolment(db, req, r.enrolment_id);
    return resultDto(db, id);
  });

  /** AD-06: review queue for authorised reviewers. */
  app.get('/admin/assessments', { config: { permission: 'assessment.review' } }, async (req) => {
    const { status, page, pageSize } = parse(
      z.object({ status: z.enum(RESULT_STATUSES).default('submitted'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }),
      req.query,
    );
    const q = db
      .selectFrom('assessment_results as r')
      .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .leftJoin('users as sub', 'sub.id', 'r.submitted_by')
      .where('r.status', '=', status);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['r.id', 'r.status', 'r.total_score', 'r.max_score', 'r.outcome', 'r.submitted_at', 'r.submitted_by', 'u.name', 'cp.candidate_code', 'b.id as batch_id', 'b.name as batch_name', 'c.title as course_title', 'sub.name as submitted_by_name'])
      .orderBy('r.submitted_at', 'asc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        totalScore: r.total_score,
        maxScore: r.max_score,
        outcome: r.outcome,
        submittedAt: iso(r.submitted_at),
        submittedByName: r.submitted_by_name,
        ownSubmission: r.submitted_by === req.actor!.userId,
        candidate: { name: r.name, code: r.candidate_code },
        batch: { id: r.batch_id, name: r.batch_name },
        courseTitle: r.course_title,
      })),
      page,
      pageSize,
      total: Number(total),
    };
  });

  /** Reviewer decisions. The submitter can never review their own result (also a database rule). */
  const decisions = [
    { path: 'approve', to: 'approved', needsReason: false, action: 'assessment.approved' },
    { path: 'return', to: 'returned', needsReason: true, action: 'assessment.returned' },
    { path: 'reject', to: 'rejected', needsReason: true, action: 'assessment.rejected' },
  ] as const;
  for (const d of decisions) {
    app.post(`/results/:id/${d.path}`, { config: { permission: 'assessment.review' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = d.needsReason ? parse(reasonSchema, req.body).reason : null;
      return db.transaction().execute(async (trx) => {
        const r = await trx
          .selectFrom('assessment_results as r')
          .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
          .select(['r.id', 'r.status', 'r.submitted_by', 'r.outcome', 'r.enrolment_id', 'e.batch_id', 'e.candidate_id'])
          .where('r.id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!r) throw notFound('Result');
        if (r.status !== 'submitted') throw invalid(`Only a submitted result can be reviewed. This one is ${r.status}.`);
        if (r.submitted_by === req.actor!.userId) throw forbidden('You submitted this result, so someone else must review it.');
        const now = new Date();
        await trx
          .updateTable('assessment_results')
          .set({ status: d.to, reviewed_by: req.actor!.userId, reviewed_at: now, review_reason: reason, released_at: d.to === 'approved' ? now : null, updated_at: now })
          .where('id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), {
          action: d.action,
          entityType: 'batch',
          entityId: r.batch_id,
          before: { resultId: id, status: r.status },
          after: { resultId: id, candidateId: r.candidate_id, status: d.to, outcome: r.outcome, reason },
        });
        // SH-07: an approved result is released to the learner; a returned or rejected one goes back to the trainer.
        const ctx = await trx
          .selectFrom('batches as b')
          .innerJoin('courses as c', 'c.id', 'b.course_id')
          .innerJoin('users as u', (j) => j.on('u.id', '=', r.candidate_id))
          .select(['b.name as batch', 'b.trainer_id', 'c.title as course', 'u.name as learner'])
          .where('b.id', '=', r.batch_id)
          .executeTakeFirstOrThrow();
        if (d.to === 'approved') await notify(trx, [r.candidate_id], 'result_released', { course: ctx.course, outcome: r.outcome }, `/learn/learning/${r.enrolment_id}/result`);
        else await notify(trx, [r.submitted_by ?? ctx.trainer_id], d.to === 'returned' ? 'result_returned' : 'result_rejected', { ...ctx, reason }, `/partner/batches/${r.batch_id}`);
        return { id, status: d.to };
      });
    });
  }
};
