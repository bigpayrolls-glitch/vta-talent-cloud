import { z } from 'zod';
import { uuidSchema } from './schemas.js';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from './training.js';

// ---------------------------------------------------------------------------
// Phase 4: offline attendance for trainers (TR-04, TR-08, TR-09)
// ---------------------------------------------------------------------------

/** Most changes one sync request may carry. The phone sends larger queues in several requests. */
export const SYNC_MAX_OPS = 200;

/**
 * One attendance mark captured on the phone. `opId` is made on the phone and never reused,
 * so sending the same change twice (a retry after a dropped connection) is harmless.
 * `force` is set only when the trainer has seen a conflict and chosen to keep their mark.
 */
export const attendanceOpSchema = z.object({
  opId: uuidSchema,
  batchId: uuidSchema,
  date: z.iso.date(),
  candidateId: uuidSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  capturedAt: z.iso.datetime({ offset: true }),
  force: z.boolean().optional(),
});
export type AttendanceOp = z.infer<typeof attendanceOpSchema>;

export const attendanceSyncSchema = z.object({
  ops: z.array(attendanceOpSchema).min(1).max(SYNC_MAX_OPS),
});

/**
 * What happened to each change:
 * - applied: saved.
 * - unchanged: the saved mark was already the same.
 * - duplicate: this exact change was received before (nothing done again).
 * - conflict: someone saved a different mark for this person and date after this change was captured.
 *   Nothing was changed; the trainer chooses which mark to keep.
 * - rejected: it can never be saved (batch closed, results submitted, not enrolled, date not allowed).
 */
export const SYNC_OUTCOMES = ['applied', 'unchanged', 'duplicate', 'conflict', 'rejected'] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

export interface SyncOpResult {
  opId: string;
  outcome: SyncOutcome;
  message?: string;
  /** For a conflict: the mark that is saved now, and when it was captured. */
  server?: { status: AttendanceStatus; capturedAt: string };
}

export interface SyncResponse {
  results: SyncOpResult[];
  serverTime: string;
}

/**
 * The batch essentials a trainer's phone keeps for working offline (TR-09): only their own
 * active batches, each candidate's name and ID, and the attendance already saved.
 * No phone numbers, email, dates of birth, addresses or documents.
 */
export interface OfflineBatch {
  id: string;
  name: string;
  courseName: string;
  centreName: string;
  startDate: string;
  endDate: string;
  people: { candidateId: string; name: string; code: string; locked: boolean }[];
  marks: { date: string; candidateId: string; status: AttendanceStatus; capturedAt: string }[];
}

export interface OfflineSnapshot {
  today: string;
  generatedAt: string;
  batches: OfflineBatch[];
}

/** How long a phone keeps the roster without refreshing it before it is deleted (TR-09 policy). */
export const OFFLINE_ROSTER_MAX_AGE_DAYS = 14;
