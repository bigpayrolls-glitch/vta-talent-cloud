import {
  attendanceSyncSchema,
  type AttendanceOp,
  type AttendanceStatus,
  type OfflineBatch,
  type OfflineSnapshot,
  type SyncOpResult,
  type SyncResponse,
} from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { todayIst } from '../../lib/dates.js';
import { invalid } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';

/** A phone clock may be wrong. A change "captured" in the future counts as captured when it arrived. */
const clampCaptured = (iso: string, now: Date): Date => {
  const d = new Date(iso);
  return d.getTime() > now.getTime() ? now : d;
};

/**
 * Phase 4: offline attendance for trainers.
 * - GET /trainer/offline-snapshot: the batch essentials a phone keeps for working offline (TR-09).
 * - POST /sync/attendance: changes captured on the phone, each judged on its own (TR-04).
 */
export const offlineRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/trainer/offline-snapshot', { config: { permission: 'attendance.record' } }, async (req): Promise<OfflineSnapshot> => {
    const actor = req.actor!;
    const today = todayIst();
    const generatedAt = new Date().toISOString();
    const centreIds = actor.assignments.filter((a) => a.role === 'trainer' && a.centreId).map((a) => a.centreId!);
    if (centreIds.length === 0) return { today, generatedAt, batches: [] };

    // Only batches this trainer runs now, at a centre where they still hold the trainer role.
    const batches = await db
      .selectFrom('batches as b')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select(['b.id', 'b.name', 'b.start_date', 'b.end_date', 'c.title as course_name', 'ce.name as centre_name'])
      .where('b.trainer_id', '=', actor.userId)
      .where('b.centre_id', 'in', centreIds)
      .where('b.status', '=', 'active')
      .orderBy('b.start_date')
      .execute();
    if (batches.length === 0) return { today, generatedAt, batches: [] };
    const ids = batches.map((b) => b.id);

    // Name and candidate ID only: no phone, email, date of birth, address or documents.
    const people = await db
      .selectFrom('enrolments as e')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'e.candidate_id')
      .select([
        'e.batch_id',
        'e.candidate_id',
        'u.name',
        'cp.candidate_code',
        sql<boolean>`exists (select 1 from assessment_results ar where ar.enrolment_id = e.id and ar.status in ('submitted','approved'))`.as('locked'),
      ])
      .where('e.batch_id', 'in', ids)
      .where('e.status', '=', 'enrolled')
      .orderBy('u.name')
      .execute();

    const marks = await db
      .selectFrom('attendance_sessions as s')
      .innerJoin('attendance_records as r', 'r.session_id', 's.id')
      .select(['s.batch_id', 's.session_date', 'r.candidate_id', 'r.status', sql<Date>`coalesce(r.client_captured_at, r.updated_at)`.as('captured_at')])
      .where('s.batch_id', 'in', ids)
      .execute();

    const enrolledIn = new Set(people.map((p) => `${p.batch_id}:${p.candidate_id}`));
    return {
      today,
      generatedAt,
      batches: batches.map(
        (b): OfflineBatch => ({
          id: b.id,
          name: b.name,
          courseName: b.course_name,
          centreName: b.centre_name,
          startDate: b.start_date,
          endDate: b.end_date,
          people: people.filter((p) => p.batch_id === b.id).map((p) => ({ candidateId: p.candidate_id, name: p.name, code: p.candidate_code, locked: p.locked })),
          marks: marks
            .filter((m) => m.batch_id === b.id && enrolledIn.has(`${b.id}:${m.candidate_id}`))
            .map((m) => ({ date: m.session_date, candidateId: m.candidate_id, status: m.status, capturedAt: new Date(m.captured_at).toISOString() })),
        }),
      ),
    };
  });

  app.post('/sync/attendance', { config: { permission: 'attendance.record' } }, async (req): Promise<SyncResponse> => {
    const { ops } = parse(attendanceSyncSchema, req.body);
    if (new Set(ops.map((o) => o.opId)).size !== ops.length) throw invalid('Each change must have its own id');
    const actor = req.actor!;
    const now = new Date();
    const today = todayIst(now);
    const results = new Map<string, SyncOpResult>();

    // 1. Changes received before. Applied ones are reported as duplicates; anything else is judged again,
    //    so a phone that lost the first answer still learns about a conflict.
    const seen = await db.selectFrom('attendance_sync_ops').select(['op_id', 'user_id', 'outcome']).where('op_id', 'in', ops.map((o) => o.opId)).execute();
    const retry = new Set<string>();
    for (const s of seen) {
      if (s.user_id !== actor.userId) results.set(s.op_id, { opId: s.op_id, outcome: 'rejected', message: 'This change id was already used.' });
      else if (s.outcome === 'applied' || s.outcome === 'unchanged') results.set(s.op_id, { opId: s.op_id, outcome: 'duplicate' });
      else retry.add(s.op_id);
    }

    // 2. Checks that do not depend on the saved marks. Unknown and other trainers' batches get the same answer.
    const pending = ops.filter((o) => !results.has(o.opId));
    const batchIds = [...new Set(pending.map((o) => o.batchId))];
    const batches = batchIds.length ? await db.selectFrom('batches').select(['id', 'status', 'trainer_id', 'centre_id', 'start_date', 'end_date']).where('id', 'in', batchIds).execute() : [];
    const enrolments = batchIds.length
      ? await db
          .selectFrom('enrolments as e')
          .innerJoin('users as u', 'u.id', 'e.candidate_id')
          .select([
            'e.batch_id',
            'e.candidate_id',
            'e.status',
            'u.name',
            sql<boolean>`exists (select 1 from assessment_results ar where ar.enrolment_id = e.id and ar.status in ('submitted','approved'))`.as('locked'),
          ])
          .where('e.batch_id', 'in', batchIds)
          .where('e.candidate_id', 'in', [...new Set(pending.map((o) => o.candidateId))])
          .execute()
      : [];

    const reject = (o: AttendanceOp, message: string) => results.set(o.opId, { opId: o.opId, outcome: 'rejected', message });
    const accepted: AttendanceOp[] = [];
    for (const o of pending) {
      const b = batches.find((x) => x.id === o.batchId);
      const mine = b && b.trainer_id === actor.userId && actor.assignments.some((a) => a.role === 'trainer' && a.centreId === b.centre_id);
      const e = enrolments.find((x) => x.batch_id === o.batchId && x.candidate_id === o.candidateId);
      if (!b || !mine) reject(o, 'This batch is not assigned to you.');
      else if (b.status !== 'active') reject(o, b.status === 'planned' ? 'This batch has not started yet.' : `This batch is ${b.status}; attendance is closed.`);
      else if (o.date < b.start_date || o.date > b.end_date) reject(o, `The date is outside the batch dates (${b.start_date} to ${b.end_date}).`);
      else if (o.date > today) reject(o, 'Attendance cannot be recorded for a future date.');
      else if (!e || e.status !== 'enrolled') reject(o, 'This person is not enrolled in the batch.');
      else if (e.locked) reject(o, `${e.name}: results already submitted, attendance is locked.`);
      else accepted.push(o);
    }

    // Rejections are kept too, so a retried one gets the same answer without being judged against later data.
    const rejectedNew = pending.filter((o) => results.get(o.opId)?.outcome === 'rejected' && !retry.has(o.opId));
    if (rejectedNew.length) {
      await db
        .insertInto('attendance_sync_ops')
        .values(rejectedNew.map((o) => ({ op_id: o.opId, user_id: actor.userId, batch_id: o.batchId, outcome: 'rejected' as const, message: results.get(o.opId)!.message ?? null, captured_at: clampCaptured(o.capturedAt, now) })))
        .onConflict((oc) => oc.column('op_id').doNothing())
        .execute();
    }

    // 3. Each batch and date in its own transaction, oldest change first.
    const groups = new Map<string, AttendanceOp[]>();
    for (const o of [...accepted].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
      const k = `${o.batchId}|${o.date}`;
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }

    for (const group of groups.values()) {
      const { batchId, date } = group[0]!;
      await db.transaction().execute(async (trx) => {
        // One writer per batch at a time, so two phones (or a retry racing the original) cannot both create a mark.
        await trx.selectFrom('batches').select('id').where('id', '=', batchId).forUpdate().execute();
        let session = await trx.selectFrom('attendance_sessions').select('id').where('batch_id', '=', batchId).where('session_date', '=', date).executeTakeFirst();
        const existing = session
          ? await trx
              .selectFrom('attendance_records')
              .select(['id', 'candidate_id', 'status', sql<Date>`coalesce(client_captured_at, updated_at)`.as('captured_at')])
              .where('session_id', '=', session.id)
              .execute()
          : [];
        const changes: { candidateId: string; from: AttendanceStatus | null; to: AttendanceStatus }[] = [];

        for (const o of group) {
          const captured = clampCaptured(o.capturedAt, now);
          const cur = existing.find((x) => x.candidate_id === o.candidateId);
          let outcome: 'applied' | 'unchanged' | 'conflict' = 'applied';
          if (cur && cur.status === o.status) outcome = 'unchanged';
          else if (cur && !o.force && new Date(cur.captured_at).getTime() > captured.getTime()) outcome = 'conflict';

          // Claim the change id first. If another request claimed it a moment ago, this is a duplicate.
          const claim = retry.has(o.opId)
            ? await trx.updateTable('attendance_sync_ops').set({ outcome, message: null, received_at: now }).where('op_id', '=', o.opId).where('outcome', 'in', ['conflict', 'rejected']).returning('op_id').executeTakeFirst()
            : await trx
                .insertInto('attendance_sync_ops')
                .values({ op_id: o.opId, user_id: actor.userId, batch_id: batchId, outcome, captured_at: captured })
                .onConflict((oc) => oc.column('op_id').doNothing())
                .returning('op_id')
                .executeTakeFirst();
          if (!claim) {
            results.set(o.opId, { opId: o.opId, outcome: 'duplicate' });
            continue;
          }

          if (outcome === 'conflict') {
            results.set(o.opId, {
              opId: o.opId,
              outcome,
              message: 'A different mark was saved for this person and date after yours was taken.',
              server: { status: cur!.status, capturedAt: new Date(cur!.captured_at).toISOString() },
            });
            continue;
          }
          results.set(o.opId, { opId: o.opId, outcome });
          if (outcome === 'unchanged') continue;

          if (!session) {
            session = { id: newId() };
            await trx.insertInto('attendance_sessions').values({ id: session.id, batch_id: batchId, session_date: date, created_by: actor.userId }).execute();
          }
          if (cur) {
            await trx
              .updateTable('attendance_records')
              .set({ status: o.status, captured_by: actor.userId, client_op_id: o.opId, client_captured_at: captured, updated_at: now })
              .where('id', '=', cur.id)
              .execute();
            changes.push({ candidateId: o.candidateId, from: cur.status, to: o.status });
            cur.status = o.status;
            cur.captured_at = captured;
          } else {
            const id = newId();
            await trx
              .insertInto('attendance_records')
              .values({ id, session_id: session.id, candidate_id: o.candidateId, status: o.status, captured_by: actor.userId, client_op_id: o.opId, client_captured_at: captured })
              .execute();
            existing.push({ id, candidate_id: o.candidateId, status: o.status, captured_at: captured });
            changes.push({ candidateId: o.candidateId, from: null, to: o.status });
          }
        }

        if (changes.length) {
          await audit(trx, auditCtx(req), {
            action: 'attendance.synced',
            entityType: 'batch',
            entityId: batchId,
            before: { date, marks: changes.filter((c) => c.from).map((c) => ({ candidateId: c.candidateId, status: c.from })) },
            after: { date, marks: changes.map((c) => ({ candidateId: c.candidateId, status: c.to })), forced: group.filter((o) => o.force).length },
          });
        }
      });
    }

    return { results: ops.map((o) => results.get(o.opId)!), serverTime: now.toISOString() };
  });
};
