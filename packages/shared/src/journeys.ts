import { z } from 'zod';
import { PAY_METHODS } from './catalogue.js';
import { uuidSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// AutoTalent Grid career journeys (29 Oct 2026): four tracks, each in four steps (Beginner, Bronze, Silver,
// Expert). Each step is its own course with its own fee. A learner enrols and pays for the course itself;
// AutoTalent Grid then assigns the training partner and batch. A step opens once the step before it is complete.
// ---------------------------------------------------------------------------

export const TRACKS = ['technician', 'parts_manager', 'service_advisor', 'floor_supervisor'] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_LABEL: Record<Track, string> = {
  technician: 'Technician',
  parts_manager: 'Parts Manager',
  service_advisor: 'Service Advisor',
  floor_supervisor: 'Floor Supervisor',
};
/** The certification at the end of each track. */
export const TRACK_CERTIFICATION: Record<Track, string> = {
  technician: 'AutoTalent Grid Master Technician',
  parts_manager: 'AutoTalent Grid Master Parts Manager',
  service_advisor: 'AutoTalent Grid Master Service Advisor',
  floor_supervisor: 'AutoTalent Grid Master Floor Supervisor',
};

export const TRACK_STEPS = [1, 2, 3, 4] as const;
export type TrackStep = (typeof TRACK_STEPS)[number];
export const TRACK_STEP_LABEL: Record<TrackStep, string> = { 1: 'Beginner', 2: 'Bronze', 3: 'Silver', 4: 'Expert' };

/** Where a course sits in a career journey (null for other courses). */
export interface JourneyInfo {
  track: Track;
  step: TrackStep;
  /** The step before, which must be complete first (null for step 1). */
  previous: { id: string; title: string } | null;
}

export const BOOKING_STATUSES = ['awaiting_batch', 'placed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  awaiting_batch: 'Enrolled, batch to be assigned',
  placed: 'Batch assigned',
  cancelled: 'Cancelled',
};

/** A learner enrols in a course that AutoTalent Grid places in a batch. */
export const courseBookingSchema = z.object({
  courseId: uuidSchema,
  /** Needed only when there is something to pay (test payments). */
  method: z.enum(PAY_METHODS).optional(),
  needsStay: z.boolean().default(false),
  acceptTerms: z.literal(true, 'Accept the terms to continue'),
});

/** Admin: put a booked learner into a batch of the course (at any training partner's centre). */
export const assignBookingSchema = z.object({ batchId: uuidSchema });
