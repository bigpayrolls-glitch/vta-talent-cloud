import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

/**
 * AutoTalent Grid career journeys (29 Oct 2026), from the "Career Learning Journey" chart:
 * four tracks, each in four steps (Beginner 30 days, Bronze 15, Silver 30, Expert 15). Each step is a course of
 * its own. Learners enrol and pay for the course (course_bookings); AutoTalent Grid then assigns the batch.
 *
 * The 16 courses are added switched off with no fee: an Admin sets each fee and switches it on.
 */

type Row = { step: 1 | 2 | 3 | 4; title: string; topics: string[] };
const DAYS = { 1: 30, 2: 15, 3: 30, 4: 15 } as const;
const LEVEL = { 1: 'beginner', 2: 'beginner_to_intermediate', 3: 'intermediate', 4: 'advanced' } as const;
const STEP = { 1: 'Beginner', 2: 'Bronze', 3: 'Silver', 4: 'Expert' } as const;

const JOURNEYS: Record<string, { code: string; name: string; certification: string; rows: Row[] }> = {
  technician: {
    code: 'TECH',
    name: 'Technician',
    certification: 'AutoTalent Grid Master Technician',
    rows: [
      { step: 1, title: '7 Brands 18 Points Check Up', topics: ['7 brands overview (Hero, Honda, TVS, Bajaj, Yamaha, Suzuki, Royal Enfield)', '18 point vehicle check-up', 'Basic tools and equipment', 'Engine oil, lubricants and fluids', 'Basic service process and safety'] },
      { step: 2, title: 'Body Work and Accidental Work', topics: ['Body parts identification', 'Denting basics', 'Accident damage assessment', 'Panel replacement', 'Insurance process basics'] },
      { step: 3, title: 'Half Engine and Full Engine', topics: ['Engine components and systems', 'Half engine overhaul', 'Full engine overhaul', 'Clutch, gear box, cylinder head', 'Engine testing and performance'] },
      { step: 4, title: 'Troubleshooting: Electrical and Mechanical', topics: ['Electrical system diagnostics', 'Mechanical troubleshooting', 'BS6 technology training', 'Scanner tools and advanced diagnostics', 'Live troubleshooting practice'] },
    ],
  },
  parts_manager: {
    code: 'PARTS',
    name: 'Parts Manager',
    certification: 'AutoTalent Grid Master Parts Manager',
    rows: [
      { step: 1, title: '7 Brands Fast Moving Parts', topics: ['OEM, OES and local parts', 'Fast moving parts identification', 'Parts catalogue and numbers', 'Inventory basics and bin location', 'GRN, indent and stock management'] },
      { step: 2, title: 'Body Parts and Accidental Parts', topics: ['Body parts identification', 'Accident parts and replacement', 'Plastic parts and lighting', 'Estimation and insurance parts', 'Returnable parts management'] },
      { step: 3, title: 'Half Engine and Full Engine Parts', topics: ['Engine parts identification', 'Half engine parts', 'Full engine parts', 'Ordering and supplier management', 'Slow moving and critical inventory'] },
      { step: 4, title: 'Electrical, Mechanical and BS6 Parts', topics: ['Electrical components', 'Mechanical components', 'BS6 parts and sensors', 'Inventory analytics and reporting', 'ERP / DMS for parts management'] },
    ],
  },
  service_advisor: {
    code: 'SA',
    name: 'Service Advisor',
    certification: 'AutoTalent Grid Master Service Advisor',
    rows: [
      { step: 1, title: 'Job Card, Process and AMC Basics', topics: ['Basic job card writing', '18 point vehicle check-up', 'Frequently occurring problems', 'Reminder to reminder process', 'AMC basics: 30 customers'] },
      { step: 2, title: 'Plan for Per Vehicle Revenue Increase', topics: ['Upselling and cross selling', 'Accessories and lubricants', 'AMC conversion', 'Customer retention', 'Per vehicle revenue plan'] },
      { step: 3, title: 'Half Engine and Full Engine Job Cards', topics: ['Engine diagnosis basics', 'Half engine job card writing', 'Full engine job card writing', 'Converting to half / full engine', 'Insurance job process'] },
      { step: 4, title: 'Test Drive and Troubleshooting (BS6)', topics: ['Test drive and customer handling', 'Electrical troubleshooting', 'Mechanical troubleshooting', 'BS6 technology training', 'Advanced customer satisfaction'] },
    ],
  },
  floor_supervisor: {
    code: 'FS',
    name: 'Floor Supervisor',
    certification: 'AutoTalent Grid Master Floor Supervisor',
    rows: [
      { step: 1, title: 'Workshop Operations Basics', topics: ['Workshop SOP and safety', 'Bay allocation and workflow', 'Technician allocation', '18 point inspection monitoring', 'Quality check and customer delivery'] },
      { step: 2, title: 'Productivity and Team Coordination', topics: ['Workshop productivity', 'Bay utilisation', 'Time management', 'Team coordination', 'Daily reporting'] },
      { step: 3, title: 'Engine Job Monitoring and Quality', topics: ['Engine job monitoring', 'Quality audit', 'Service KPI tracking', 'Productivity tracking', 'Customer satisfaction'] },
      { step: 4, title: 'Leadership and Advanced Operations', topics: ['Troubleshooting support', 'Team leadership', 'Workshop profitability', 'Training and coaching', 'Process improvement'] },
    ],
  },
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE courses
      ADD COLUMN track text CHECK (track IN ('technician', 'parts_manager', 'service_advisor', 'floor_supervisor')),
      ADD COLUMN track_step integer CHECK (track_step BETWEEN 1 AND 4),
      ADD CONSTRAINT courses_track_both CHECK ((track IS NULL) = (track_step IS NULL));
    CREATE UNIQUE INDEX courses_track_step_unique ON courses (track, track_step) WHERE track IS NOT NULL;

    CREATE TABLE course_bookings (
      id uuid PRIMARY KEY,
      candidate_id uuid NOT NULL REFERENCES users(id),
      course_id uuid NOT NULL REFERENCES courses(id),
      status text NOT NULL DEFAULT 'awaiting_batch' CHECK (status IN ('awaiting_batch', 'placed', 'cancelled')),
      needs_stay boolean NOT NULL DEFAULT false,
      amount_paise integer NOT NULL CHECK (amount_paise >= 0),
      stay_paise integer NOT NULL DEFAULT 0,
      method text CHECK (method IN ('upi', 'card', 'netbanking', 'wallet', 'other')),
      provider text NOT NULL CHECK (provider IN ('test', 'free', 'razorpay')),
      provider_payment_id text UNIQUE,
      receipt_number text NOT NULL UNIQUE,
      enrolment_id uuid REFERENCES enrolments(id),
      assigned_by uuid REFERENCES users(id),
      assigned_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX course_bookings_status_idx ON course_bookings (status, created_at);
    CREATE UNIQUE INDEX course_bookings_one_open ON course_bookings (candidate_id, course_id) WHERE status = 'awaiting_batch';

    ALTER TABLE payment_orders
      DROP CONSTRAINT payment_orders_purpose_check,
      ADD CONSTRAINT payment_orders_purpose_check CHECK (purpose IN ('plan', 'course', 'booking')),
      ADD COLUMN course_id uuid REFERENCES courses(id),
      DROP CONSTRAINT payment_orders_check,
      ADD CONSTRAINT payment_orders_check CHECK (
        (purpose = 'plan' AND organisation_id IS NOT NULL AND plan IS NOT NULL AND billing_cycle IS NOT NULL)
        OR (purpose = 'course' AND batch_id IS NOT NULL)
        OR (purpose = 'booking' AND course_id IS NOT NULL)
      );
  `.execute(db);

  // The 16 courses, unless a course with the same code is already there. Switched off until an Admin sets the fee.
  for (const [track, j] of Object.entries(JOURNEYS)) {
    for (const r of j.rows) {
      const code = `ATG-${j.code}-${r.step}`;
      const exists = await sql<{ id: string }>`SELECT id FROM courses WHERE code = ${code}`.execute(db);
      if (exists.rows.length) continue;
      const id = randomUUID();
      const description =
        `${j.name} career journey, step ${r.step} of 4 (${STEP[r.step]}). ` +
        (r.step === 4 ? `Completing this step leads to the ${j.certification} certification. ` : '') +
        'You enrol and pay online; AutoTalent Grid then assigns your training centre and batch.';
      await sql`
        INSERT INTO courses (id, code, title, skill_area, level, delivery_mode, duration_value, duration_unit, description,
          attendance_threshold_pct, pass_mark_pct, fee_paise, status, approval_status, certificate_type, skills, learning_outcomes,
          track, track_step, course_type, created_at, updated_at)
        VALUES (${id}, ${code}, ${`${j.name} ${STEP[r.step]}: ${r.title}`}, '2W', ${LEVEL[r.step]}, 'classroom', ${DAYS[r.step]}, 'days', ${description},
          75, 60, 0, 'inactive', 'published', 'AutoTalent Grid Certificate', ${r.topics}, ${r.topics},
          ${track}, ${r.step}, 'certification', now(), now())
      `.execute(db);
      let order = 1;
      for (const topic of r.topics) {
        await sql`INSERT INTO assessment_criteria (id, course_id, label, max_score, required, sort_order) VALUES (${randomUUID()}, ${id}, ${topic}, 20, false, ${order++})`.execute(db);
      }
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_check;
    DELETE FROM payment_orders WHERE purpose = 'booking';
    ALTER TABLE payment_orders
      DROP COLUMN IF EXISTS course_id,
      DROP CONSTRAINT payment_orders_purpose_check,
      ADD CONSTRAINT payment_orders_purpose_check CHECK (purpose IN ('plan', 'course')),
      ADD CONSTRAINT payment_orders_check CHECK ((purpose = 'plan' AND organisation_id IS NOT NULL AND plan IS NOT NULL AND billing_cycle IS NOT NULL) OR (purpose = 'course' AND batch_id IS NOT NULL));
    DROP TABLE IF EXISTS course_bookings;
    DROP INDEX IF EXISTS courses_track_step_unique;
    ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_track_both, DROP COLUMN IF EXISTS track_step, DROP COLUMN IF EXISTS track;
  `.execute(db);
}
