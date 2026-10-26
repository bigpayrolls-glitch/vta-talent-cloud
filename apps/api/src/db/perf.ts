/**
 * Phase 10 performance check (requirements §15: "p95 under 2.5 seconds for common read APIs at agreed pilot load").
 *
 *   PERF_DATABASE_URL=postgres://vta:vta_dev@localhost:5432/vta_perf pnpm --filter @vta/api perf
 *
 * Resets that database (never a production one), loads the demo data, then adds pilot-scale data:
 * 10,000 learners, 200 batches with 20 sessions each (~200,000 attendance marks), 300 jobs, 20,000 applications,
 * 50,000 notifications and 100,000 audit events. Then it times each common read API 30 times in-process
 * (database and application time; network and hosting add to this) and prints p50/p95.
 * The pilot load is not agreed yet; these numbers are an assumption to change when VTA confirms it.
 */
import { NOTICE_VERSION } from '@vta/shared';
import { sql } from 'kysely';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { memoryProviders } from '../lib/providers.js';
import { databaseStorage } from '../lib/storage.js';
import { createDb } from './index.js';
import { migrateToLatest, resetDatabase } from './migrate.js';
import { seed } from './seed.js';

const LEARNERS = Number(process.env.PERF_LEARNERS ?? 10_000);
const BATCHES = 200;
const SESSIONS = 20;
const JOBS = 300;
const RUNS = 30;

const url = process.env.PERF_DATABASE_URL;
if (!url) throw new Error('Set PERF_DATABASE_URL to a database that may be wiped.');
const config = { ...loadConfig({ ...process.env, NODE_ENV: 'development', DATABASE_URL: url }), databaseUrl: url };
const db = createDb(url);

console.log('Resetting and seeding…');
await resetDatabase(db, 'development');
await migrateToLatest(db, false);
const { ids, credentials } = await seed(db);
const t0 = performance.now();
console.log(`Adding ${LEARNERS.toLocaleString('en-IN')} learners and their records…`);

await sql`
  INSERT INTO users (id, name, phone, status, phone_verified_at, date_of_birth)
  SELECT gen_random_uuid(), 'Perf Learner ' || g, '+9197' || lpad(g::text, 8, '0'), 'active', now(), DATE '2000-01-01' + (g % 3000)
  FROM generate_series(1, ${LEARNERS}) g
`.execute(db);
await sql`
  INSERT INTO role_assignments (id, user_id, role) SELECT gen_random_uuid(), id, 'learner' FROM users WHERE name LIKE 'Perf Learner %'
`.execute(db);
await sql`
  INSERT INTO candidate_profiles (user_id, candidate_code, city, skill_areas, experience_months, languages, searchable, verification_status, source)
  SELECT id, 'PRF' || lpad(row_number() OVER ()::text, 7, '0'),
         (ARRAY['Bengaluru','Mysuru','Hubballi','Mangaluru','Belagavi'])[1 + (random() * 4)::int],
         ARRAY[(ARRAY['2W','4W','EV','CV'])[1 + (random() * 3)::int]], (random() * 60)::int, ARRAY['Kannada','English'],
         random() < 0.6, (ARRAY['pending','verified','verified','verified'])[1 + (random() * 3)::int]::text::candidate_status, 'import'
  FROM users WHERE name LIKE 'Perf Learner %'
`.execute(db);

// Learners have accepted the current notice and terms, so the learner APIs answer as for a real learner.
for (const purpose of ['privacy_notice', 'terms'] as const) {
  await sql`
    INSERT INTO consent_events (id, user_id, purpose, granted, notice_version, source, recorded_by)
    SELECT gen_random_uuid(), id, ${purpose}, true, ${NOTICE_VERSION}, 'self', id FROM users WHERE name LIKE 'Perf Learner %'
  `.execute(db);
}
await sql`
  INSERT INTO batches (id, name, course_id, centre_id, trainer_id, start_date, end_date, capacity, status)
  SELECT gen_random_uuid(), 'Perf batch ' || g, ${ids.course2w}, ${ids.centrePartnerA}, ${ids.trainerA}, DATE '2026-06-01' + g, DATE '2026-09-01' + g, 60, 'active'
  FROM generate_series(1, ${BATCHES}) g
`.execute(db);
await sql`
  WITH l AS (SELECT id, row_number() OVER () AS n FROM users WHERE name LIKE 'Perf Learner %'),
       b AS (SELECT id, row_number() OVER () AS n FROM batches WHERE name LIKE 'Perf batch %')
  INSERT INTO enrolments (id, candidate_id, batch_id, status)
  SELECT gen_random_uuid(), l.id, b.id, 'enrolled' FROM l JOIN b ON b.n = 1 + (l.n % ${BATCHES})
`.execute(db);
await sql`
  INSERT INTO attendance_sessions (id, batch_id, session_date)
  SELECT gen_random_uuid(), b.id, b.start_date + s FROM batches b, generate_series(0, ${SESSIONS - 1}) s WHERE b.name LIKE 'Perf batch %'
`.execute(db);
await sql`
  INSERT INTO attendance_records (id, session_id, candidate_id, status, captured_by)
  SELECT gen_random_uuid(), s.id, e.candidate_id, (ARRAY['present','present','present','absent','late'])[1 + (random() * 4)::int]::attendance_status, ${ids.trainerA}
  FROM attendance_sessions s JOIN enrolments e ON e.batch_id = s.batch_id JOIN batches b ON b.id = s.batch_id WHERE b.name LIKE 'Perf batch %'
`.execute(db);

await sql`
  INSERT INTO jobs (id, organisation_id, title, skill_area, skills, min_experience_months, city, openings, description, closing_date, vta_certificate_preferred, status, created_by, published_at)
  SELECT gen_random_uuid(), ${ids.employerA}, 'Perf technician ' || g, (ARRAY['2W','4W','EV','CV'])[1 + (g % 4)], ARRAY['Servicing'], 0,
         (ARRAY['Bengaluru','Mysuru','Hubballi'])[1 + (g % 3)], 2, 'Service and repair vehicles following the workshop checklist.', DATE '2027-03-31', false, 'published', ${ids.employerAdminA}, now()
  FROM generate_series(1, ${JOBS}) g
`.execute(db);
await sql`
  WITH l AS (SELECT id, row_number() OVER () AS n FROM users WHERE name LIKE 'Perf Learner %'),
       j AS (SELECT id, row_number() OVER () AS n FROM jobs WHERE title LIKE 'Perf technician %')
  INSERT INTO job_applications (id, job_id, candidate_id, status, consent_snapshot)
  SELECT gen_random_uuid(), j.id, l.id, (ARRAY['applied','shortlisted','interview','rejected'])[1 + (l.n % 4)]::application_status, '{}'::jsonb
  FROM l JOIN j ON j.n IN (1 + (l.n % ${JOBS}), 1 + ((l.n + 7) % ${JOBS}))
`.execute(db);
await sql`
  INSERT INTO notifications (id, user_id, template, params, link)
  SELECT gen_random_uuid(), u.id, 'application_update', '{"job":"Perf technician","company":"Sunrise","status":"shortlisted"}', '/learn/applications'
  FROM users u, generate_series(1, 5) WHERE u.name LIKE 'Perf Learner %'
`.execute(db);
await sql`
  INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id)
  SELECT gen_random_uuid(), ${ids.opsAdmin}, 'candidate.updated', 'user', u.id FROM users u, generate_series(1, 10) WHERE u.name LIKE 'Perf Learner %'
`.execute(db);
await sql`
  ANALYZE
`.execute(db);
console.log(`Data added in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);

const mem = memoryProviders();
const app = await buildApp({ db, config, providers: mem, storage: databaseStorage(db), logger: false });
await app.ready();

async function cookieFor(email: string): Promise<string> {
  const password = credentials.find((c) => c.login === email)!.password!;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return String(res.headers['set-cookie']).split(';')[0]!;
}
async function cookieForPhone(phone: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone } });
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code: mem.sentOtps.get(phone) } });
  return String(res.headers['set-cookie']).split(';')[0]!;
}

const ops = await cookieFor('ops@demo.vta.local');
const employer = await cookieFor('employer-a@demo.vta.local');
const partner = await cookieFor('partner-a@demo.vta.local');
const learner = await cookieForPhone('+919700000042');
const bigBatch = (await db.selectFrom('batches').select('id').where('name', '=', 'Perf batch 7').executeTakeFirstOrThrow()).id;

const checks: [string, string, string][] = [
  ['Admin dashboard', ops, '/admin/dashboard'],
  ['Admin candidate list', ops, '/admin/candidates?page=1&pageSize=20'],
  ['Admin candidate search', ops, '/admin/candidates?q=Perf%20Learner%2042&pageSize=20'],
  ['Admin batch list', ops, '/batches?page=1&pageSize=20'],
  ['Batch roster (50 people)', ops, `/batches/${bigBatch}/roster`],
  ['Batch attendance summary', ops, `/batches/${bigBatch}/attendance/summary`],
  ['Admin jobs queue', ops, '/admin/jobs?status=published'],
  ['Hiring outcomes', ops, '/admin/hiring-outcomes'],
  ['Audit log', ops, '/admin/audit-events?page=1&pageSize=25'],
  ['Cohort report', ops, '/admin/reports/cohort'],
  ['Programme metrics (partner)', partner, `/programmes/${ids.programmeA}/metrics`],
  ['Employer jobs', employer, '/employer/jobs'],
  ['Employer candidate search', employer, '/employer/candidates?skillArea=2W'],
  ['Learner job list', learner, '/jobs'],
  ['Learner applications', learner, '/me/applications'],
  ['Learner notifications', learner, '/notifications'],
  ['Notification count (polled)', learner, '/notifications/unread-count'],
];

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
const rows: string[] = [];
let worst = 0;
for (const [name, cookie, url] of checks) {
  const times: number[] = [];
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    const res = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
    times.push(performance.now() - s);
    status = res.statusCode;
  }
  if (status !== 200) throw new Error(`${name}: expected 200, got ${status}`);
  const p95 = pct(times, 95);
  worst = Math.max(worst, p95);
  rows.push(`| ${name} | ${status} | ${pct(times, 50).toFixed(0)} | ${p95.toFixed(0)} |`);
}
console.log(`\n| Read API | Status | p50 ms | p95 ms |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`);
console.log(`Slowest p95: ${worst.toFixed(0)} ms (target 2,500 ms).`);
await app.close();
await db.destroy();
if (worst > 2500) process.exit(1);
