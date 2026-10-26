import { attendancePct } from '@vta/shared';
import type { FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/index.js';
import type { Batch, Database } from '../../db/types.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { batchReadScope, batchVisible } from '../../policy/index.js';

type Executor = Kysely<Database> | Transaction<Database>;

/** A batch the actor can see. Anything else is "not found" (SEC-02). */
export async function visibleBatch(db: DB, req: FastifyRequest, id: string): Promise<Batch> {
  const batch = await db.selectFrom('batches').selectAll().where('id', '=', id).executeTakeFirst();
  if (!batch || !batchVisible(await batchReadScope(db, req.actor!), batch)) throw notFound('Batch');
  return batch;
}

/**
 * For recording attendance and assessments: the actor must be the trainer assigned to the batch
 * and still hold the trainer role at its centre. Others who can see the batch get 403; others get 404.
 */
export async function trainerBatch(db: DB, req: FastifyRequest, id: string): Promise<Batch> {
  const batch = await visibleBatch(db, req, id);
  const actor = req.actor!;
  const atCentre = actor.assignments.some((a) => a.role === 'trainer' && a.centreId === batch.centre_id);
  if (batch.trainer_id !== actor.userId || !atCentre) throw forbidden('Only the trainer assigned to this batch can record this.');
  return batch;
}

export interface AttendanceStats {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  pct: number | null;
}

/** Attendance per candidate in a batch, counted over the sessions held so far. */
export async function attendanceByCandidate(db: Executor, batchId: string): Promise<{ sessionsHeld: number; byCandidate: Map<string, AttendanceStats> }> {
  const sessions = await db.selectFrom('attendance_sessions').select('id').where('batch_id', '=', batchId).execute();
  const rows = sessions.length
    ? await db
        .selectFrom('attendance_records')
        .select(['candidate_id', 'status'])
        .where('session_id', 'in', sessions.map((s) => s.id))
        .execute()
    : [];
  const byCandidate = new Map<string, AttendanceStats>();
  for (const r of rows) {
    const s = byCandidate.get(r.candidate_id) ?? { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, pct: null };
    s[r.status] += 1;
    byCandidate.set(r.candidate_id, s);
  }
  for (const s of byCandidate.values()) {
    s.unmarked = sessions.length - (s.present + s.late + s.absent + s.excused);
    s.pct = attendancePct(s);
  }
  return { sessionsHeld: sessions.length, byCandidate };
}

export const emptyStats = (sessionsHeld: number): AttendanceStats => ({ present: 0, late: 0, absent: 0, excused: 0, unmarked: sessionsHeld, pct: null });
