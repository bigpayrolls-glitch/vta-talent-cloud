import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICE_VERSION, type Role } from '@vta/shared';
import { loadConfig } from '../config.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { sql } from 'kysely';
import { newVerificationCode } from '../routes/operations/credentials.js';
import { createDb, type DB } from './index.js';

/**
 * Demo data for local development and staging (F-02).
 * - Every organisation, person and phone number here is invented.
 * - Passwords are generated fresh on every run, printed once, and saved to a git-ignored file.
 * - Refuses to run in production or on a database that already has users.
 */

// pnpm runs scripts from apps/api, so the file lands there (git-ignored).
const CREDENTIALS_FILE = path.resolve(process.cwd(), '.seed-credentials.txt');

const PHONE_LEARNER = '+919900000201';

const genPassword = () => `Vta-${randomBytes(9).toString('base64url')}`;

export interface SeedResult {
  credentials: { role: Role | 'pending'; name: string; login: string; password?: string }[];
  ids: Record<string, string>;
}

export async function seed(db: DB): Promise<SeedResult> {
  const existing = await db.selectFrom('users').select('id').limit(1).execute();
  if (existing.length) throw new Error('Database already has users. Run `pnpm db:reset` to start fresh.');

  const ids: Record<string, string> = {};
  const credentials: SeedResult['credentials'] = [];

  const org = async (key: string, type: 'vta' | 'employer' | 'partner', legal_name: string, verification: 'verified' | 'pending', subtype?: string) => {
    ids[key] = newId();
    await db
      .insertInto('organisations')
      .values({
        id: ids[key],
        type,
        partner_subtype: subtype ?? null,
        legal_name,
        registration_ids: JSON.stringify({}),
        address: 'Bengaluru, Karnataka',
        verification_status: verification,
        verified_at: verification === 'verified' ? new Date() : null,
        status: 'active',
      })
      .execute();
  };

  await org('vta', 'vta', 'AutoTalent Grid (platform operator)', 'verified');
  await org('employerA', 'employer', 'Sunrise Two-Wheeler Service (demo)', 'verified');
  await org('employerB', 'employer', 'Metro Auto Works (demo)', 'verified');
  await org('partnerA', 'partner', 'Skill Bridge Foundation (demo)', 'verified', 'ngo');
  await org('partnerB', 'partner', 'Velocity Training Academy (demo)', 'verified', 'training_provider');
  await org('employerPending', 'employer', 'Green Volt EV Garage (demo)', 'pending');
  await org('sponsorA', 'partner', 'Bright Lubricants CSR Foundation (demo)', 'verified', 'csr_sponsor');

  const centre = async (key: string, name: string, city: string, organisationKey?: string) => {
    ids[key] = newId();
    await db
      .insertInto('centres')
      .values({ id: ids[key], name, city, organisation_id: organisationKey ? ids[organisationKey]! : null, address: `${city}, Karnataka`, status: 'active' })
      .execute();
  };
  await centre('centreVta', 'AutoTalent Grid Bengaluru Centre', 'Bengaluru');
  await centre('centrePartnerA', 'Skill Bridge Peenya Centre', 'Bengaluru', 'partnerA');
  await centre('centrePartnerB', 'Velocity Mysuru Centre', 'Mysuru', 'partnerB');

  const person = async (
    key: string,
    name: string,
    contact: { email?: string; phone?: string },
    roles: { role: Role; org?: string; centre?: string }[],
    status: 'active' | 'pending' = 'active',
  ) => {
    ids[key] = newId();
    const password = contact.email && status === 'active' ? genPassword() : undefined;
    await db
      .insertInto('users')
      .values({
        id: ids[key],
        name,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        password_hash: password ? await hashPassword(password) : null,
        email_verified_at: contact.email ? new Date() : null,
        phone_verified_at: contact.phone ? new Date() : null,
        status,
      })
      .execute();
    for (const r of roles) {
      await db
        .insertInto('role_assignments')
        .values({
          id: newId(),
          user_id: ids[key],
          role: r.role,
          organisation_id: r.org ? ids[r.org]! : null,
          centre_id: r.centre ? ids[r.centre]! : null,
          granted_by: null,
        })
        .execute();
    }
    credentials.push({ role: roles[0]?.role ?? 'pending', name, login: contact.email ?? contact.phone!, password });
  };

  await person('superAdmin', 'Asha Super Admin', { email: 'superadmin@demo.vta.local' }, [{ role: 'super_admin' }]);
  await person('opsAdmin', 'Vikram Operations', { email: 'ops@demo.vta.local' }, [{ role: 'ops_admin' }]);
  await person('centreAdmin', 'Meena Centre Admin', { email: 'centre@demo.vta.local' }, [{ role: 'centre_admin', centre: 'centreVta' }]);
  await person('employerAdminA', 'Rahul Employer A', { email: 'employer-a@demo.vta.local' }, [{ role: 'employer_admin', org: 'employerA' }]);
  await person('recruiterA', 'Divya Recruiter A', { email: 'recruiter-a@demo.vta.local' }, [{ role: 'employer_recruiter', org: 'employerA' }]);
  await person('employerAdminB', 'Kiran Employer B', { email: 'employer-b@demo.vta.local' }, [{ role: 'employer_admin', org: 'employerB' }]);
  await person('employerAdminPending', 'Meera Employer Pending', { email: 'employer-pending@demo.vta.local' }, [{ role: 'employer_admin', org: 'employerPending' }]);
  await person('partnerAdminA', 'Farah Partner A', { email: 'partner-a@demo.vta.local' }, [{ role: 'partner_admin', org: 'partnerA' }]);
  await person('partnerViewerA', 'Sanjay Viewer A', { email: 'viewer-a@demo.vta.local' }, [{ role: 'partner_viewer', org: 'partnerA' }]);
  await person('partnerAdminB', 'Lakshmi Partner B', { email: 'partner-b@demo.vta.local' }, [{ role: 'partner_admin', org: 'partnerB' }]);
  await person('trainerA', 'Prakash Trainer', { phone: '+919900000101' }, [{ role: 'trainer', org: 'partnerA', centre: 'centrePartnerA' }]);
  await person('learner', 'Venkatesh Learner', { phone: PHONE_LEARNER }, [{ role: 'learner' }]);
  // A user with two roles, to demonstrate the portal switcher.
  await person('multiRole', 'Nisha Multi-role', { email: 'multi@demo.vta.local' }, [
    { role: 'ops_admin' },
    { role: 'partner_viewer', org: 'partnerB' },
  ]);
  await person('pendingUser', 'Arjun Pending', { email: 'pending@demo.vta.local' }, [], 'pending');

  // ---- Phase 2: training master data (all invented) ----
  await person('trainerVta', 'Suresh AutoTalent Grid Trainer', { phone: '+919900000102' }, [{ role: 'trainer', centre: 'centreVta' }]);
  await person('trainerB', 'Imran Trainer B', { phone: '+919900000103' }, [{ role: 'trainer', org: 'partnerB', centre: 'centrePartnerB' }]);
  await person('trainerPending', 'Kavya New Trainer', { phone: '+919900000104' }, [{ role: 'trainer', org: 'partnerA', centre: 'centrePartnerA' }]);
  for (const [key, specs, status] of [
    ['trainerA', ['2W'], 'verified'],
    ['trainerVta', ['4W', 'EV'], 'verified'],
    ['trainerB', ['EV'], 'verified'],
    ['trainerPending', ['2W'], 'pending'],
  ] as const) {
    await db
      .insertInto('trainer_profiles')
      .values({ user_id: ids[key]!, specialisations: [...specs], verification_status: status, verified_at: status === 'verified' ? new Date() : null })
      .execute();
  }

  const course = async (key: string, title: string, code: string, skill: '2W' | '4W' | 'EV', months: number, criteria: [string, number, boolean][]) => {
    ids[key] = newId();
    await db
      .insertInto('courses')
      .values({
        id: ids[key],
        code,
        title,
        skill_area: skill,
        level: 'beginner_to_advanced',
        delivery_mode: 'blended',
        duration_value: months,
        duration_unit: 'months',
        training_hours: months * 80,
        attendance_threshold_pct: 75,
        pass_mark_pct: 60,
        status: 'active',
      })
      .execute();
    await db
      .insertInto('assessment_criteria')
      .values(criteria.map(([label, max, required], i) => ({ id: newId(), course_id: ids[key]!, label, max_score: max, required, sort_order: i })))
      .execute();
  };
  await course('course2w', '2W Service Technician', '2W-ST-01', '2W', 3, [
    ['Engine servicing', 30, true],
    ['Electrical diagnosis', 30, true],
    ['Brakes and suspension', 20, false],
    ['Workshop safety', 20, true],
  ]);
  await course('course4w', '4W Service Technician', '4W-ST-01', '4W', 4, [
    ['Engine and diagnostics', 40, true],
    ['Air conditioning', 30, false],
    ['Workshop safety', 30, true],
  ]);
  await course('courseEv', 'EV Technician', 'EV-T-01', 'EV', 4, [
    ['Battery systems', 40, true],
    ['High-voltage safety', 30, true],
    ['Motor and controller diagnostics', 30, false],
  ]);

  const candidate = async (key: string, name: string, phone: string, dob: string, city: string, skills: string[], status: 'pending' | 'verified', existingUser = false) => {
    if (!existingUser) {
      ids[key] = newId();
      await db.insertInto('users').values({ id: ids[key], name, phone, phone_verified_at: null, date_of_birth: dob, status: 'invited' }).execute();
      await db.insertInto('role_assignments').values({ id: newId(), user_id: ids[key], role: 'learner', granted_by: null }).execute();
    } else {
      await db.updateTable('users').set({ date_of_birth: dob }).where('id', '=', ids[key]!).execute();
    }
    const { rows } = await sql<{ n: string }>`select nextval('candidate_code_seq') as n`.execute(db);
    await db
      .insertInto('candidate_profiles')
      .values({
        user_id: ids[key]!,
        candidate_code: `ATG${String(new Date().getUTCFullYear()).slice(-2)}${String(rows[0]!.n).padStart(5, '0')}`,
        city,
        state: 'Karnataka',
        skill_areas: skills as ('2W' | '4W' | 'EV')[],
        experience_months: 6,
        languages: ['Kannada', 'English'],
        verification_status: status,
        verified_at: status === 'verified' ? new Date() : null,
        source: 'admin',
      })
      .execute();
  };
  await candidate('learner', 'Venkatesh Learner', PHONE_LEARNER, '2003-04-12', 'Bengaluru', ['2W'], 'verified', true);
  await candidate('cand1', 'Ravi Kumar', '+919900000211', '2002-08-01', 'Bengaluru', ['2W'], 'verified');
  await candidate('cand2', 'Anitha Gowda', '+919900000212', '2001-01-15', 'Bengaluru', ['2W', 'EV'], 'verified');
  await candidate('cand3', 'Mohammed Shafi', '+919900000213', '2000-11-30', 'Tumakuru', ['2W'], 'verified');
  await candidate('cand4', 'Deepa Rao', '+919900000214', '2003-06-21', 'Bengaluru', ['4W'], 'verified');
  await candidate('cand5', 'Naveen Shetty', '+919900000215', '1999-03-09', 'Mysuru', ['EV'], 'verified');
  await candidate('cand6', 'Pooja Naik', '+919900000216', '2004-02-02', 'Mysuru', ['EV', '4W'], 'verified');
  await candidate('cand7', 'Kiran Patil', '+919900000217', '2002-12-12', 'Hubballi', ['4W'], 'pending');
  // Same name and date of birth as cand1: flagged as a possible duplicate for review.
  await candidate('cand8', 'Ravi Kumar', '+919900000218', '2002-08-01', 'Bengaluru', ['2W'], 'pending');
  await db.updateTable('candidate_profiles').set({ duplicate_of: ids.cand1! }).where('user_id', '=', ids.cand8!).execute();

  const batch = async (key: string, name: string, courseKey: string, centreKey: string, trainerKey: string, start: string, end: string, status: 'planned' | 'active', enrol: string[]) => {
    ids[key] = newId();
    await db
      .insertInto('batches')
      .values({ id: ids[key], name, course_id: ids[courseKey]!, centre_id: ids[centreKey]!, trainer_id: ids[trainerKey]!, start_date: start, end_date: end, capacity: 20, status })
      .execute();
    for (const c of enrol) {
      await db.insertInto('enrolments').values({ id: newId(), candidate_id: ids[c]!, batch_id: ids[key], status: 'enrolled' }).execute();
    }
  };
  await batch('batchA', '2W Peenya October 2026', 'course2w', 'centrePartnerA', 'trainerA', '2026-10-12', '2027-01-12', 'active', ['learner', 'cand1', 'cand2', 'cand3']);
  await batch('batchVta', '4W Bengaluru November 2026', 'course4w', 'centreVta', 'trainerVta', '2026-11-16', '2027-03-16', 'planned', ['cand4']);
  await batch('batchB', 'EV Mysuru November 2026', 'courseEv', 'centrePartnerB', 'trainerB', '2026-11-23', '2027-03-23', 'planned', ['cand5', 'cand6']);
  // Phase 13: course fees (from the brand design) and an open 2W batch learners can enrol in online.
  for (const [key, fee] of [['course2w', 4999], ['course4w', 9999], ['courseEv', 11999]] as const) {
    await db.updateTable('courses').set({ fee_paise: fee * 100 }).where('id', '=', ids[key]!).execute();
  }
  await batch('batchOpen2w', '2W Peenya November 2026', 'course2w', 'centrePartnerA', 'trainerA', '2026-11-10', '2027-02-10', 'planned', []);

  // ---- Phase 3: attendance, assessments, a credential (all invented) ----
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const markSessions = async (batchKey: string, start: string, days: number[], marks: Record<string, ('present' | 'absent' | 'late' | 'excused')[]>, by: string) => {
    for (const [i, d] of days.entries()) {
      const sid = newId();
      await db.insertInto('attendance_sessions').values({ id: sid, batch_id: ids[batchKey]!, session_date: addDays(start, d), created_by: ids[by]! }).execute();
      for (const [cand, list] of Object.entries(marks)) {
        await db.insertInto('attendance_records').values({ id: newId(), session_id: sid, candidate_id: ids[cand]!, status: list[i % list.length]!, captured_by: ids[by]! }).execute();
      }
    }
  };
  // Running batch: six sessions so far. Mohammed is below the 75% threshold.
  await markSessions('batchA', '2026-10-12', [0, 1, 2, 3, 4, 7], {
    learner: ['present'],
    cand1: ['present', 'present', 'late'],
    cand2: ['present', 'present', 'excused'],
    cand3: ['absent', 'present', 'absent'],
  }, 'trainerA');

  // A finished batch with results at every stage.
  await batch('batchDone', '2W Peenya July 2026', 'course2w', 'centrePartnerA', 'trainerA', '2026-07-06', '2026-10-06', 'active', ['cand1', 'cand2', 'cand6']);
  await markSessions('batchDone', '2026-07-06', [0, 7, 14, 21, 28, 35, 42, 49], {
    cand1: ['present'],
    cand2: ['present', 'present', 'present', 'late'],
    cand6: ['absent', 'present'],
  }, 'trainerA');
  const criteria = await db.selectFrom('assessment_criteria').select(['id', 'max_score']).where('course_id', '=', ids.course2w!).orderBy('sort_order').execute();
  const enrolmentOf = async (batchKey: string, cand: string) =>
    (await db.selectFrom('enrolments').select('id').where('batch_id', '=', ids[batchKey]!).where('candidate_id', '=', ids[cand]!).executeTakeFirstOrThrow()).id;
  const result = async (key: string, batchKey: string, cand: string, share: number, status: 'submitted' | 'approved', outcome: 'pass' | 'fail') => {
    ids[key] = newId();
    const total = criteria.reduce((t, c) => t + Math.round(c.max_score * share), 0);
    const max = criteria.reduce((t, c) => t + c.max_score, 0);
    await db
      .insertInto('assessment_results')
      .values({
        id: ids[key],
        enrolment_id: await enrolmentOf(batchKey, cand),
        status,
        total_score: total,
        max_score: max,
        outcome,
        recorded_by: ids.trainerA!,
        submitted_by: ids.trainerA!,
        submitted_at: new Date('2026-10-07T10:00:00Z'),
        reviewed_by: status === 'approved' ? ids.opsAdmin! : null,
        reviewed_at: status === 'approved' ? new Date('2026-10-09T10:00:00Z') : null,
        released_at: status === 'approved' ? new Date('2026-10-09T10:00:00Z') : null,
      })
      .execute();
    await db
      .insertInto('assessment_scores')
      .values(criteria.map((c) => ({ id: newId(), result_id: ids[key]!, criterion_id: c.id, score: Math.round(c.max_score * share), outcome: outcome === 'pass' ? ('pass' as const) : ('fail' as const) })))
      .execute();
  };
  await result('resultRavi', 'batchDone', 'cand1', 0.85, 'approved', 'pass');
  await result('resultAnitha', 'batchDone', 'cand2', 0.7, 'approved', 'pass');
  await result('resultPooja', 'batchDone', 'cand6', 0.5, 'submitted', 'fail');
  // Complete the batch the same way the API does: completion from attendance (threshold 75%).
  await db.updateTable('batches').set({ status: 'completed' }).where('id', '=', ids.batchDone!).execute();
  for (const [cand, done, pct] of [['cand1', true, 100], ['cand2', true, 100], ['cand6', false, 50]] as const) {
    await db.updateTable('enrolments').set({ status: done ? 'completed' : 'not_completed', attendance_pct: pct }).where('batch_id', '=', ids.batchDone!).where('candidate_id', '=', ids[cand]!).execute();
  }
  // Ravi already has his credential; Anitha is eligible and waiting for one.
  ids.credentialRavi = newId();
  const verificationCode = newVerificationCode();
  await db
    .insertInto('credentials')
    .values({
      id: ids.credentialRavi,
      candidate_id: ids.cand1!,
      course_id: ids.course2w!,
      enrolment_id: await enrolmentOf('batchDone', 'cand1'),
      result_id: ids.resultRavi!,
      holder_name: 'Ravi Kumar',
      course_title: '2W Service Technician',
      issue_date: '2026-10-10',
      issuer_name: 'AutoTalent Grid',
      verification_code: verificationCode,
      status: 'active',
      issued_by: ids.opsAdmin!,
    })
    .execute();
  ids.credentialRaviCode = verificationCode;

  // ---- Phase 5: consent records (invented) ----
  // Venkatesh (the demo learner) accepted the notice and terms and chose to be searchable.
  // Ravi and the other candidates were added by staff and are asked to accept on their first sign-in.
  for (const [purpose, version] of [['privacy_notice', NOTICE_VERSION], ['terms', NOTICE_VERSION], ['profile_searchable', null]] as const) {
    await db
      .insertInto('consent_events')
      .values({ id: newId(), user_id: ids.learner!, purpose, granted: true, notice_version: version, source: 'self', recorded_by: ids.learner! })
      .execute();
  }
  await db.updateTable('candidate_profiles').set({ searchable: true, preferred_work_area: 'Bengaluru North (Peenya, Yeshwanthpur)', availability: 'Weekdays' }).where('user_id', '=', ids.learner!).execute();

  // ---- Phase 6: employers, jobs and an application (all invented) ----
  const company = async (key: string, sector: string, city: string, contact: [string, string, string]) =>
    db
      .updateTable('organisations')
      .set({ sector, city, contact_name: contact[0], contact_email: contact[1], contact_phone: contact[2], description: 'Demo company for the AutoTalent Grid pilot.' })
      .where('id', '=', ids[key]!)
      .execute();
  await company('employerA', 'service_workshop', 'Bengaluru', ['Rahul Employer A', 'employer-a@demo.vta.local', '+919900000301']);
  await company('employerB', 'dealership', 'Mysuru', ['Kiran Employer B', 'employer-b@demo.vta.local', '+919900000302']);
  await db.updateTable('organisations').set({ sector: 'ev_service', city: 'Bengaluru' }).where('id', '=', ids.employerPending!).execute();

  const job = async (key: string, org: string, by: string, status: 'draft' | 'pending_review' | 'published', v: { title: string; skill: '2W' | '4W' | 'EV'; city: string; closing: string; salary?: [number, number] }) => {
    ids[key] = newId();
    await db
      .insertInto('jobs')
      .values({
        id: ids[key],
        organisation_id: ids[org]!,
        title: v.title,
        skill_area: v.skill,
        skills: v.skill === 'EV' ? ['Battery diagnostics', 'Motor controllers'] : ['Engine servicing', 'Brakes', 'Electrical basics'],
        min_experience_months: 6,
        city: v.city,
        location: v.city === 'Bengaluru' ? 'Peenya Industrial Area' : null,
        salary_min: v.salary?.[0] ?? null,
        salary_max: v.salary?.[1] ?? null,
        openings: 3,
        shift: 'Day shift, 6 days a week',
        description: 'Service and repair customer vehicles in our workshop, following the service checklist and safety rules. Training on our tools is given.',
        closing_date: v.closing,
        vta_certificate_preferred: true,
        status,
        created_by: ids[by]!,
        submitted_at: status === 'draft' ? null : new Date(),
        published_at: status === 'published' ? new Date() : null,
        moderated_by: status === 'published' ? ids.opsAdmin! : null,
        moderated_at: status === 'published' ? new Date() : null,
      })
      .execute();
  };
  await job('job2wA', 'employerA', 'employerAdminA', 'published', { title: 'Two-wheeler service technician', skill: '2W', city: 'Bengaluru', closing: '2026-12-15', salary: [16000, 22000] });
  await job('jobDraftA', 'employerA', 'recruiterA', 'draft', { title: 'Senior two-wheeler technician', skill: '2W', city: 'Bengaluru', closing: '2026-12-31' });
  await job('jobEvB', 'employerB', 'employerAdminB', 'pending_review', { title: 'EV service technician', skill: 'EV', city: 'Mysuru', closing: '2026-12-20', salary: [18000, 26000] });
  // A live four-wheeler job, so a two-wheeler learner sees "Recommended for your skills" and "Other jobs".
  await job('job4wB', 'employerB', 'employerAdminB', 'published', { title: 'Four-wheeler service technician', skill: '4W', city: 'Mysuru', closing: '2026-12-31', salary: [17000, 24000] });

  // Phase 12: the two verified demo employers have plans set by AutoTalent Grid for a year; the pending one is on Free.
  const yearOn = new Date(Date.now() + 365 * 86_400_000);
  await db
    .insertInto('employer_subscriptions')
    .values([
      { organisation_id: ids.employerA!, plan: 'growth', billing_cycle: null, period_start: new Date(), period_end: yearOn, source: 'admin', updated_by: ids.superAdmin! },
      { organisation_id: ids.employerB!, plan: 'starter', billing_cycle: null, period_start: new Date(), period_end: yearOn, source: 'admin', updated_by: ids.superAdmin! },
    ])
    .execute();

  // Anitha applied to Sunrise's job and was shortlisted.
  ids.applicationAnitha = newId();
  await db
    .insertInto('job_applications')
    .values({
      id: ids.applicationAnitha,
      job_id: ids.job2wA!,
      candidate_id: ids.cand2!,
      status: 'shortlisted',
      consent_snapshot: JSON.stringify({ sharedAt: new Date().toISOString(), noticeVersion: NOTICE_VERSION, employer: 'Sunrise Two-Wheeler Service (demo)', job: 'Two-wheeler service technician', fields: ['Name', 'Mobile number', 'City and preferred work area', 'Skills, experience, education, languages and availability'], certificates: [], documents: [] }),
    })
    .execute();
  for (const [from, to, by, kind] of [[null, 'applied', 'cand2', 'candidate'], ['applied', 'shortlisted', 'recruiterA', 'employer']] as const) {
    await db.insertInto('application_events').values({ id: newId(), application_id: ids.applicationAnitha, from_status: from, to_status: to, actor_id: ids[by]!, actor_kind: kind }).execute();
  }
  for (const purpose of ['privacy_notice', 'terms'] as const) {
    await db.insertInto('consent_events').values({ id: newId(), user_id: ids.cand2!, purpose, granted: true, notice_version: NOTICE_VERSION, source: 'self', recorded_by: ids.cand2! }).execute();
  }

  // ---- Phase 7: a sponsored programme run by Skill Bridge (invented) ----
  ids.programmeA = newId();
  await db
    .insertInto('programmes')
    .values({
      id: ids.programmeA,
      name: 'Two-Wheeler Livelihoods Bengaluru 2026',
      description: 'Training unemployed young people as two-wheeler service technicians in Bengaluru, with placement support.',
      sponsor_organisation_id: ids.sponsorA!,
      target_count: 40,
      start_date: '2026-07-01',
      end_date: '2027-03-31',
      status: 'active',
      reporting_requirements: 'Quarterly outcome report to the sponsor: enrolled, completed, certified and verified joinings.',
      beneficiary_fields: ['candidateCode', 'city', 'batch', 'enrolmentStatus', 'attendance', 'assessment', 'certificate', 'employment'],
      sharing_basis: null,
      budget_reference: 'Sponsor agreement SBF/2026/07 (demo)',
      budget_amount: 1200000,
      budget_source: 'Signed sponsor agreement (demo figure)',
      budget_as_of: '2026-07-01',
      created_by: ids.opsAdmin!,
    })
    .execute();
  await db.insertInto('programme_partners').values({ programme_id: ids.programmeA, organisation_id: ids.partnerA! }).execute();
  await db.insertInto('programme_batches').values([ids.batchA!, ids.batchDone!].map((b) => ({ programme_id: ids.programmeA!, batch_id: b }))).execute();

  return { credentials, ids };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  if (config.NODE_ENV === 'production' && config.APP_ENV !== 'staging') {
    console.error('Refusing to seed demo data when NODE_ENV=production (allowed only with APP_ENV=staging).');
    process.exit(1);
  }
  const db = createDb(config.databaseUrl);
  try {
    const { credentials, ids } = await seed(db);
    const lines = [
      'AutoTalent Grid — demo sign-ins (generated by `pnpm db:seed`; regenerated on every reset)',
      'Email users: sign in with email + password. Phone users: sign in with OTP; the code prints in the API console.',
      '',
      ...credentials.map((c) => `${c.role.padEnd(20)} ${c.name.padEnd(22)} ${c.login.padEnd(30)} ${c.password ?? (c.login.startsWith('+') ? '(phone OTP)' : '(no password: awaiting approval)')}`),
    ];
    writeFileSync(CREDENTIALS_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
    console.log(lines.join('\n'));
    console.log(`\nSaved to ${CREDENTIALS_FILE} (git-ignored).`);
    console.log(`Demo credential check page: /verify/${ids.credentialRaviCode}`);
  } finally {
    await db.destroy();
  }
}
