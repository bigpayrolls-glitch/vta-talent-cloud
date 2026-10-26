import { attendanceSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { todayIst } from '../../lib/dates.js';
import { invalid } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { attendanceByCandidate, emptyStats, trainerBatch, visibleBatch } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** R-02 / TR-03: attendance by session date. */
export const attendanceRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** Sessions held so far with their counts, plus the marks for one date if asked for. */
  app.get('/batches/:id/attendance', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { date } = parse(z.object({ date: z.iso.date().optional() }), req.query);
    const batch = await visibleBatch(db, req, id);
    const sessions = await db
      .selectFrom('attendance_sessions as s')
      .leftJoin('attendance_records as r', 'r.session_id', 's.id')
      .select([
        's.id',
        's.session_date',
        sql<string>`count(*) filter (where r.status = 'present')`.as('present'),
        sql<string>`count(*) filter (where r.status = 'late')`.as('late'),
        sql<string>`count(*) filter (where r.status = 'absent')`.as('absent'),
        sql<string>`count(*) filter (where r.status = 'excused')`.as('excused'),
      ])
      .where('s.batch_id', '=', id)
      .groupBy(['s.id', 's.session_date'])
      .orderBy('s.session_date', 'desc')
      .execute();

    let marks: { candidateId: string; status: string; capturedAt: string }[] | undefined;
    if (date) {
      const session = sessions.find((s) => s.session_date === date);
      marks = session
        ? (
            await db.selectFrom('attendance_records').select(['candidate_id', 'status', 'updated_at']).where('session_id', '=', session.id).execute()
          ).map((m) => ({ candidateId: m.candidate_id, status: m.status, capturedAt: new Date(m.updated_at).toISOString() }))
        : [];
    }
    const today = todayIst();
    return {
      today,
      canRecord:
        batch.status === 'active' &&
        batch.trainer_id === req.actor!.userId &&
        req.actor!.assignments.some((a) => a.role === 'trainer' && a.centreId === batch.centre_id),
      window: { from: batch.start_date, to: batch.end_date < today ? batch.end_date : today },
      sessions: sessions.map((s) => ({
        date: s.session_date,
        present: Number(s.present),
        late: Number(s.late),
        absent: Number(s.absent),
        excused: Number(s.excused),
      })),
      marks,
    };
  });

  /**
   * Record or correct attendance for one date. Only the batch trainer, only while the batch is active,
   * only for enrolled candidates whose results have not been submitted yet.
   * `clientOpId` makes a retried save harmless (needed for offline sync in Phase 4).
   */
  app.put('/batches/:id/attendance', { config: { permission: 'attendance.record' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { date, marks } = parse(attendanceSchema, req.body);
    const batch = await trainerBatch(db, req, id);
    if (batch.status !== 'active') throw invalid(batch.status === 'planned' ? 'Start the batch before recording attendance.' : `Attendance cannot change in a ${batch.status} batch.`);
    const today = todayIst();
    if (date < batch.start_date || date > batch.end_date) throw invalid('The date is outside the batch dates', { date: `Between ${batch.start_date} and ${batch.end_date}` });
    if (date > today) throw invalid('Attendance cannot be recorded for a future date', { date: 'Future date' });

    const ids = [...new Set(marks.map((m) => m.candidateId))];
    if (ids.length !== marks.length) throw invalid('Each candidate can be marked once per date');
    const enrolled = await db
      .selectFrom('enrolments as e')
      .leftJoin('assessment_results as ar', (j) => j.onRef('ar.enrolment_id', '=', 'e.id').on('ar.status', 'in', ['submitted', 'approved']))
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .select(['e.candidate_id', 'e.status', 'u.name', 'ar.status as result_status'])
      .where('e.batch_id', '=', id)
      .where('e.candidate_id', 'in', ids)
      .execute();
    const problems: Record<string, string> = {};
    for (const cid of ids) {
      const e = enrolled.find((x) => x.candidate_id === cid);
      if (!e || e.status !== 'enrolled') problems[cid] = 'Not enrolled in this batch';
      else if (e.result_status) problems[cid] = `${e.name}: results already submitted, attendance is locked`;
    }
    if (Object.keys(problems).length) throw invalid('Some marks cannot be saved. Nothing was changed.', problems);

    return db.transaction().execute(async (trx) => {
      let session = await trx.selectFrom('attendance_sessions').select('id').where('batch_id', '=', id).where('session_date', '=', date).executeTakeFirst();
      if (!session) {
        session = { id: newId() };
        await trx.insertInto('attendance_sessions').values({ id: session.id, batch_id: id, session_date: date, created_by: req.actor!.userId }).execute();
      }
      const existing = await trx.selectFrom('attendance_records').select(['id', 'candidate_id', 'status', 'client_op_id']).where('session_id', '=', session.id).execute();
      const changes: { candidateId: string; from: string | null; to: string }[] = [];
      let duplicates = 0;
      for (const m of marks) {
        if (m.clientOpId && existing.some((x) => x.client_op_id === m.clientOpId)) {
          duplicates++;
          continue;
        }
        const cur = existing.find((x) => x.candidate_id === m.candidateId);
        if (cur) {
          if (cur.status === m.status) continue;
          await trx
            .updateTable('attendance_records')
            .set({ status: m.status, captured_by: req.actor!.userId, client_op_id: m.clientOpId ?? null, updated_at: new Date() })
            .where('id', '=', cur.id)
            .execute();
        } else {
          await trx
            .insertInto('attendance_records')
            .values({ id: newId(), session_id: session.id, candidate_id: m.candidateId, status: m.status, captured_by: req.actor!.userId, client_op_id: m.clientOpId ?? null })
            .execute();
        }
        changes.push({ candidateId: m.candidateId, from: cur?.status ?? null, to: m.status });
      }
      if (changes.length) {
        await audit(trx, auditCtx(req), {
          action: 'attendance.recorded',
          entityType: 'batch',
          entityId: id,
          before: { date, marks: changes.filter((c) => c.from).map((c) => ({ candidateId: c.candidateId, status: c.from })) },
          after: { date, marks: changes.map((c) => ({ candidateId: c.candidateId, status: c.to })) },
        });
      }
      return { date, saved: changes.length, unchanged: marks.length - changes.length - duplicates, duplicates };
    });
  });

  /** Per-candidate attendance summary for a batch (used by the roster and the completion rule). */
  app.get('/batches/:id/attendance/summary', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await visibleBatch(db, req, id);
    const course = await db.selectFrom('courses').select('attendance_threshold_pct').where('id', '=', batch.course_id).executeTakeFirstOrThrow();
    const { sessionsHeld, byCandidate } = await attendanceByCandidate(db, id);
    const enrolled = await db.selectFrom('enrolments').select(['candidate_id']).where('batch_id', '=', id).where('status', '!=', 'withdrawn').execute();
    return {
      sessionsHeld,
      thresholdPct: course.attendance_threshold_pct,
      items: enrolled.map((e) => {
        const s = byCandidate.get(e.candidate_id) ?? emptyStats(sessionsHeld);
        return { candidateId: e.candidate_id, ...s, belowThreshold: s.pct !== null && s.pct < course.attendance_threshold_pct };
      }),
    };
  });
};
