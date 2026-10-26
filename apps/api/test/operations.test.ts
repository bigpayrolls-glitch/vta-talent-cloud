import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 3 acceptance criteria R-01 to R-06: attendance, assessment, review, credentials, alerts. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const enrolmentId = async (batchKey: string, candKey: string) =>
  (await ctx.db.selectFrom('enrolments').select('id').where('batch_id', '=', ctx.ids[batchKey]!).where('candidate_id', '=', ctx.ids[candKey]!).executeTakeFirstOrThrow()).id;

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['opsAdmin', 'superAdmin', 'centreAdmin', 'partnerAdminA', 'partnerViewerA'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
  c.trainerA = await loginPhone(ctx, PHONE.trainerA);
  c.trainerB = await loginPhone(ctx, PHONE.trainerB);
  c.trainerVta = await loginPhone(ctx, PHONE.trainerVta);
});
afterAll(() => ctx.close());

const allFour = () => ['learner', 'cand1', 'cand2', 'cand3'].map((k) => ctx.ids[k]!);

describe('R-02 attendance', () => {
  it('the batch trainer records present, absent, late or excused for a date', async () => {
    const [learner, cand1, cand2, cand3] = allFour();
    const res = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, {
      date: '2026-10-21',
      marks: [
        { candidateId: learner, status: 'present' },
        { candidateId: cand1, status: 'late' },
        { candidateId: cand2, status: 'excused' },
        { candidateId: cand3, status: 'absent' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: '2026-10-21', saved: 4, unchanged: 0 });
    const day = await c.trainerA!.get(`/batches/${ctx.ids.batchA}/attendance?date=2026-10-21`);
    expect(day.body.canRecord).toBe(true);
    expect(day.body.marks.find((m: { candidateId: string }) => m.candidateId === cand1).status).toBe('late');
    expect(day.body.sessions.find((s: { date: string }) => s.date === '2026-10-21')).toMatchObject({ present: 1, late: 1, excused: 1, absent: 1 });
  });

  it('saving the same marks again changes nothing; a correction is audited with before and after', async () => {
    const [, , , cand3] = allFour();
    const same = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-21', marks: [{ candidateId: cand3, status: 'absent' }] });
    expect(same.body).toMatchObject({ saved: 0, unchanged: 1 });
    const fix = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-21', marks: [{ candidateId: cand3, status: 'present' }] });
    expect(fix.body.saved).toBe(1);
    const ev = await ctx.db.selectFrom('audit_events').select(['before', 'after']).where('action', '=', 'attendance.recorded').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(ev.before).toEqual({ date: '2026-10-21', marks: [{ candidateId: cand3, status: 'absent' }] });
    expect(ev.after).toEqual({ date: '2026-10-21', marks: [{ candidateId: cand3, status: 'present' }] });
  });

  it('a retried save with the same operation id is not applied twice', async () => {
    const [learner] = allFour();
    const op = randomUUID();
    const body = { date: '2026-10-22', marks: [{ candidateId: learner, status: 'present', clientOpId: op }] };
    expect((await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, body)).body.saved).toBe(1);
    expect((await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, body)).body).toMatchObject({ saved: 0, duplicates: 1 });
  });

  it('refuses future dates, dates outside the batch, unenrolled candidates and batches not yet started', async () => {
    const [learner] = allFour();
    expect((await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-12-01', marks: [{ candidateId: learner, status: 'present' }] })).body.error.fields.date).toBe('Future date');
    expect((await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-01', marks: [{ candidateId: learner, status: 'present' }] })).status).toBe(400);
    const outsider = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-21', marks: [{ candidateId: ctx.ids.cand5, status: 'present' }] });
    expect(outsider.body.error.fields[ctx.ids.cand5!]).toBe('Not enrolled in this batch');
    const planned = await c.trainerB!.put(`/batches/${ctx.ids.batchB}/attendance`, { date: '2026-10-21', marks: [{ candidateId: ctx.ids.cand5, status: 'present' }] });
    expect(planned.body.error.message).toMatch(/Start the batch/);
  });

  it('only the assigned trainer can record: others who can see the batch get 403, the rest 404', async () => {
    const body = { date: '2026-10-21', marks: [{ candidateId: ctx.ids.learner, status: 'absent' }] };
    expect((await c.partnerAdminA!.put(`/batches/${ctx.ids.batchA}/attendance`, body)).status).toBe(403);
    expect((await c.opsAdmin!.put(`/batches/${ctx.ids.batchA}/attendance`, body)).status).toBe(403);
    expect((await c.trainerVta!.put(`/batches/${ctx.ids.batchA}/attendance`, body)).status).toBe(404);
    expect((await c.trainerB!.get(`/batches/${ctx.ids.batchA}/attendance`)).status).toBe(404);
    // Partners can read it
    expect((await c.partnerViewerA!.get(`/batches/${ctx.ids.batchA}/attendance`)).body.canRecord).toBe(false);
  });
});

describe('R-06 attendance alerts', () => {
  it('the roster shows attendance so far and flags anyone below the course threshold', async () => {
    const roster = await c.trainerA!.get(`/batches/${ctx.ids.batchA}/roster`);
    expect(roster.body.thresholdPct).toBe(75);
    expect(roster.body.sessionsHeld).toBe(8);
    const byName = Object.fromEntries(roster.body.items.map((r: { name: string }) => [r.name, r]));
    expect(byName['Venkatesh Learner'].attendance.pct).toBe(100);
    expect(byName['Venkatesh Learner'].belowThreshold).toBe(false);
    // Mohammed: absent half the seeded sessions, present on the 21st after the correction, not marked on the 22nd.
    expect(byName['Mohammed Shafi'].belowThreshold).toBe(true);
    expect(byName['Mohammed Shafi'].attendance.unmarked).toBe(1);
    // Excused sessions do not count against Anitha
    expect(byName['Anitha Gowda'].attendance.excused).toBeGreaterThan(0);
    expect(byName['Anitha Gowda'].belowThreshold).toBe(false);
  });
});

describe('R-03 to R-04 assessment, submission and review', () => {
  let criteria: { id: string; label: string; maxScore: number; required: boolean }[];
  let resultId: string;
  let eid: string;

  it('the trainer opens the form with the course criteria', async () => {
    eid = await enrolmentId('batchA', 'cand1');
    const form = await c.trainerA!.get(`/enrolments/${eid}/assessment`);
    expect(form.body).toMatchObject({ canEdit: true, result: null, passMarkPct: 60 });
    criteria = form.body.criteria;
    expect(criteria.map((x) => x.label)).toEqual(['Engine servicing', 'Electrical diagnosis', 'Brakes and suspension', 'Workshop safety']);
    expect((await c.partnerAdminA!.get(`/enrolments/${eid}/assessment`)).body.canEdit).toBe(false);
  });

  it('checks marks against each criterion', async () => {
    const tooHigh = await c.trainerA!.put(`/enrolments/${eid}/assessment`, { scores: [{ criterionId: criteria[0]!.id, score: 31, outcome: 'pass' }] });
    expect(tooHigh.body.error.fields['scores.0.score']).toBe('At most 30');
    const noMarks = await c.trainerA!.put(`/enrolments/${eid}/assessment`, { scores: [{ criterionId: criteria[0]!.id, outcome: 'pass' }] });
    expect(noMarks.body.error.fields['scores.0.score']).toBe('Enter the marks');
  });

  it('saves a draft and works out the total', async () => {
    const res = await c.trainerA!.put(`/enrolments/${eid}/assessment`, {
      scores: [
        { criterionId: criteria[0]!.id, score: 25, outcome: 'pass', comment: 'Good carburettor work' },
        { criterionId: criteria[1]!.id, score: 22, outcome: 'pass' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'draft', totalScore: 47, maxScore: 100 });
    resultId = res.body.id;
  });

  it('cannot submit until every required criterion is assessed', async () => {
    const res = await c.trainerA!.post(`/results/${resultId}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Workshop safety/);
  });

  it('submits; the result becomes read-only and the candidate’s attendance locks', async () => {
    await c.trainerA!.put(`/enrolments/${eid}/assessment`, {
      scores: [
        { criterionId: criteria[0]!.id, score: 25, outcome: 'pass' },
        { criterionId: criteria[1]!.id, score: 22, outcome: 'pass' },
        { criterionId: criteria[2]!.id, outcome: 'not_assessed' },
        { criterionId: criteria[3]!.id, score: 15, outcome: 'pass' },
      ],
      trainerComment: 'Ready to work under supervision',
    });
    const sub = await c.trainerA!.post(`/results/${resultId}/submit`);
    expect(sub.body).toEqual({ id: resultId, status: 'submitted', outcome: 'pass' }); // 62% ≥ 60% and all required passed
    expect((await c.trainerA!.put(`/enrolments/${eid}/assessment`, { scores: [{ criterionId: criteria[0]!.id, score: 1, outcome: 'fail' }] })).status).toBe(400);
    expect((await c.trainerA!.get(`/enrolments/${eid}/assessment`)).body.canEdit).toBe(false);
    const locked = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-23', marks: [{ candidateId: ctx.ids.cand1, status: 'present' }] });
    expect(locked.body.error.fields[ctx.ids.cand1!]).toMatch(/attendance is locked/);
  });

  it('a required criterion failed means a fail, whatever the total', async () => {
    const e2 = await enrolmentId('batchA', 'cand2');
    const r = await c.trainerA!.put(`/enrolments/${e2}/assessment`, {
      scores: criteria.map((x, i) => ({ criterionId: x.id, score: x.maxScore, outcome: i === 3 ? 'fail' : 'pass' })),
    });
    const sub = await c.trainerA!.post(`/results/${r.body.id}/submit`);
    expect(sub.body.outcome).toBe('fail');
  });

  it('the review queue lists submitted results; only reviewers can open it', async () => {
    const q = await c.opsAdmin!.get('/admin/assessments');
    expect(q.body.items.map((x: { candidate: { name: string } }) => x.candidate.name)).toEqual(expect.arrayContaining(['Ravi Kumar', 'Anitha Gowda', 'Pooja Naik']));
    expect((await c.trainerA!.get('/admin/assessments')).status).toBe(403);
    expect((await c.centreAdmin!.get('/admin/assessments')).status).toBe(403);
  });

  it('trainers cannot review; a reviewer returns a result for correction with a reason', async () => {
    expect((await c.trainerA!.post(`/results/${resultId}/approve`)).status).toBe(403);
    expect((await c.opsAdmin!.post(`/results/${resultId}/return`, {})).status).toBe(400);
    expect((await c.opsAdmin!.post(`/results/${resultId}/return`, { reason: 'Brakes and suspension must be assessed' })).body.status).toBe('returned');
    const list = await c.trainerA!.get(`/batches/${ctx.ids.batchA}/assessments`);
    const row = list.body.items.find((x: { resultId: string }) => x.resultId === resultId);
    expect(row).toMatchObject({ status: 'returned', returnReason: 'Brakes and suspension must be assessed' });
    expect((await c.trainerA!.get(`/enrolments/${eid}/assessment`)).body.canEdit).toBe(true);
  });

  it('the trainer corrects and resubmits; a reviewer approves and the result is released', async () => {
    await c.trainerA!.put(`/enrolments/${eid}/assessment`, {
      scores: [
        { criterionId: criteria[0]!.id, score: 25, outcome: 'pass' },
        { criterionId: criteria[1]!.id, score: 22, outcome: 'pass' },
        { criterionId: criteria[2]!.id, score: 16, outcome: 'pass' },
        { criterionId: criteria[3]!.id, score: 15, outcome: 'pass' },
      ],
    });
    expect((await c.trainerA!.post(`/results/${resultId}/submit`)).body.status).toBe('submitted');
    const ok = await c.opsAdmin!.post(`/results/${resultId}/approve`);
    expect(ok.body.status).toBe('approved');
    const r = await c.opsAdmin!.get(`/results/${resultId}`);
    expect(r.body).toMatchObject({ status: 'approved', totalScore: 78, outcome: 'pass', reviewedByName: 'Vikram Operations', submittedByName: 'Prakash Trainer' });
    expect(r.body.releasedAt).toBeTruthy();
    expect((await c.opsAdmin!.post(`/results/${resultId}/approve`)).status).toBe(400);
  });

  it('rejecting voids a result; the trainer then records a fresh reassessment', async () => {
    const e2 = await enrolmentId('batchA', 'cand2');
    const live = await c.trainerA!.get(`/enrolments/${e2}/assessment`);
    expect((await c.opsAdmin!.post(`/results/${live.body.result.id}/reject`, { reason: 'Assessment not done under exam conditions' })).body.status).toBe('rejected');
    const after = await c.trainerA!.get(`/enrolments/${e2}/assessment`);
    expect(after.body.result).toBeNull();
    expect(after.body.canEdit).toBe(true);
    const fresh = await c.trainerA!.put(`/enrolments/${e2}/assessment`, { scores: [{ criterionId: criteria[0]!.id, score: 20, outcome: 'pass' }] });
    expect(fresh.body.id).not.toBe(live.body.result.id);
  });

  it('nobody can approve a result they submitted (API and database)', async () => {
    // Make the operations admin also a verified trainer at the VTA centre, running their own batch.
    await c.superAdmin!.post('/admin/role-assignments', { userId: ctx.ids.opsAdmin, role: 'trainer', centreId: ctx.ids.centreVta });
    await c.superAdmin!.post(`/admin/trainers/${ctx.ids.opsAdmin}/verify`);
    const both = await loginEmail(ctx, EMAIL.opsAdmin);
    const b = await both.post('/admin/batches', { name: 'Self review test', courseId: ctx.ids.course4w, centreId: ctx.ids.centreVta, trainerId: ctx.ids.opsAdmin, startDate: '2026-10-01', endDate: '2026-12-01', capacity: 5 });
    await both.post(`/admin/batches/${b.body.id}/enrolments`, { candidateIds: [ctx.ids.cand7] });
    await both.post(`/admin/batches/${b.body.id}/start`);
    const e = (await ctx.db.selectFrom('enrolments').select('id').where('batch_id', '=', b.body.id).executeTakeFirstOrThrow()).id;
    const form = await both.get(`/enrolments/${e}/assessment`);
    const saved = await both.put(`/enrolments/${e}/assessment`, { scores: form.body.criteria.map((x: { id: string; maxScore: number }) => ({ criterionId: x.id, score: x.maxScore, outcome: 'pass' })) });
    await both.post(`/results/${saved.body.id}/submit`);
    const self = await both.post(`/results/${saved.body.id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/someone else must review/);
    const queue = await both.get('/admin/assessments');
    expect(queue.body.items.find((x: { id: string }) => x.id === saved.body.id).ownSubmission).toBe(true);
    await expect(sql`update assessment_results set reviewed_by = submitted_by where id = ${saved.body.id}`.execute(ctx.db)).rejects.toThrow(/result_reviewer_differs/);
    expect((await c.superAdmin!.post(`/results/${saved.body.id}/approve`)).body.status).toBe('approved');
  });
});

describe('R-05 credentials and QR verification', () => {
  it('issues credentials only to candidates who completed, passed and were approved', async () => {
    const res = await c.opsAdmin!.post(`/admin/batches/${ctx.ids.batchDone}/credentials`);
    expect(res.status).toBe(201);
    expect(res.body.issuedTo).toEqual(['Anitha Gowda']);
    const reasons = Object.fromEntries(res.body.skipped.map((s: { name: string; reason: string }) => [s.name, s.reason]));
    expect(reasons['Ravi Kumar']).toBe('Credential already issued');
    expect(reasons['Pooja Naik']).toBe('Did not meet the attendance needed to complete');
    // Running it again issues nothing new
    expect((await c.opsAdmin!.post(`/admin/batches/${ctx.ids.batchDone}/credentials`)).body.issued).toBe(0);
  });

  it('refuses batches that are not completed and candidates who are not eligible', async () => {
    expect((await c.opsAdmin!.post(`/admin/batches/${ctx.ids.batchA}/credentials`)).body.error.message).toMatch(/Mark the batch completed/);
    const pooja = await enrolmentId('batchDone', 'cand6');
    expect((await c.opsAdmin!.post(`/admin/enrolments/${pooja}/credential`)).body.error.message).toMatch(/attendance/);
    expect((await c.centreAdmin!.post(`/admin/batches/${ctx.ids.batchDone}/credentials`)).status).toBe(403);
    expect((await c.trainerA!.post(`/admin/batches/${ctx.ids.batchDone}/credentials`)).status).toBe(403);
  });

  it('the public verify page shows only the approved fields', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/credentials/${ctx.ids.credentialRaviCode}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['courseTitle', 'disclaimer', 'holderName', 'issueDate', 'issuerName', 'status', 'statusChangedAt', 'type']);
    expect(body).toMatchObject({ holderName: 'Ravi Kumar', courseTitle: '2W Service Technician', status: 'active', type: 'Course completion record' });
    expect(body.disclaimer).toMatch(/not a government, NSDC or ASDC qualification/);
    expect(JSON.stringify(body)).not.toMatch(/\+91|ATG26|@/);
  });

  it('unknown or malformed codes reveal nothing', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/public/credentials/${'a'.repeat(32)}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/credentials/short' })).statusCode).toBe(400);
  });

  it('revoking shows "revoked" on the verify page; reissuing marks the old one as replaced', async () => {
    const list = await c.opsAdmin!.get(`/admin/credentials?batchId=${ctx.ids.batchDone}`);
    const anitha = list.body.items.find((x: { holderName: string }) => x.holderName === 'Anitha Gowda');
    expect((await c.opsAdmin!.post(`/admin/credentials/${anitha.id}/revoke`, {})).status).toBe(400);
    expect((await c.opsAdmin!.post(`/admin/credentials/${anitha.id}/revoke`, { reason: 'Issued in error' })).body.status).toBe('revoked');
    const pub = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/credentials/${anitha.verificationCode}` });
    expect(pub.json()).toMatchObject({ status: 'revoked' });
    expect(pub.json().statusChangedAt).toBeTruthy();

    const re = await c.opsAdmin!.post(`/admin/credentials/${ctx.ids.credentialRavi}/reissue`, { reason: 'Name spelling corrected' });
    expect(re.status).toBe(201);
    const old = await c.opsAdmin!.get(`/admin/credentials/${ctx.ids.credentialRavi}`);
    expect(old.body).toMatchObject({ status: 'superseded', supersededBy: re.body.id });
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/public/credentials/${ctx.ids.credentialRaviCode}` })).json().status).toBe('superseded');
    const fresh = await c.opsAdmin!.get(`/admin/credentials/${re.body.id}`);
    expect(fresh.body.status).toBe('active');
    expect(fresh.body.verificationCode).not.toBe(ctx.ids.credentialRaviCode);
  });

  it('centre admins see credentials only for their centre; partners and trainers cannot list them', async () => {
    expect((await c.centreAdmin!.get('/admin/credentials')).body.items).toEqual([]);
    expect((await c.centreAdmin!.get(`/admin/credentials/${ctx.ids.credentialRavi}`)).status).toBe(404);
    expect((await c.partnerAdminA!.get('/admin/credentials')).status).toBe(403);
    expect((await c.trainerA!.get('/admin/credentials')).status).toBe(403);
  });
});

describe('completing a batch decides completion from attendance', () => {
  it('candidates at or above the threshold complete; those below do not', async () => {
    const res = await c.opsAdmin!.post(`/admin/batches/${ctx.ids.batchA}/complete`);
    expect(res.body.status).toBe('completed');
    expect(res.body.completion).toEqual({ completed: 3, notCompleted: 1 });
    const rows = await ctx.db
      .selectFrom('enrolments as e')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .select(['u.name', 'e.status', 'e.attendance_pct'])
      .where('e.batch_id', '=', ctx.ids.batchA!)
      .execute();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['Mohammed Shafi']!.status).toBe('not_completed');
    expect(byName['Venkatesh Learner']!.status).toBe('completed');
    expect(Number(byName['Venkatesh Learner']!.attendance_pct)).toBe(100);
    // Attendance is frozen once the batch is completed
    expect((await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-23', marks: [{ candidateId: ctx.ids.learner, status: 'absent' }] })).status).toBe(400);
  });

  it('then Ravi (completed, approved, passed) can receive his credential for this batch', async () => {
    const res = await c.opsAdmin!.post(`/admin/batches/${ctx.ids.batchA}/credentials`);
    expect(res.body.issuedTo).toEqual(['Ravi Kumar']);
  });

  it('every step is in the audit log', async () => {
    const actions = (await ctx.db.selectFrom('audit_events').select('action').execute()).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['attendance.recorded', 'assessment.saved', 'assessment.submitted', 'assessment.returned', 'assessment.approved', 'assessment.rejected', 'credential.issued', 'credential.revoked', 'credential.reissued']),
    );
  });
});
