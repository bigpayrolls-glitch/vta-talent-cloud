import { randomUUID } from 'node:crypto';
import { SYNC_MAX_OPS } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 4 acceptance criteria TR-04 (offline queue sync, duplicates and conflicts) and TR-09 (what a phone may keep). */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  c.opsAdmin = await loginEmail(ctx, EMAIL.opsAdmin);
  c.partnerAdminA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.trainerA = await loginPhone(ctx, PHONE.trainerA);
  c.trainerB = await loginPhone(ctx, PHONE.trainerB);
  c.trainerVta = await loginPhone(ctx, PHONE.trainerVta);
});
afterAll(() => ctx.close());

const op = (o: Partial<{ opId: string; batchId: string; date: string; candidateId: string; status: string; capturedAt: string; force: boolean }> = {}) => ({
  opId: randomUUID(),
  batchId: ctx.ids.batchA!,
  date: '2026-10-23',
  candidateId: ctx.ids.learner!,
  status: 'present',
  capturedAt: new Date().toISOString(),
  ...o,
});
const sync = (client: Client, ops: unknown[]) => client.post('/sync/attendance', { ops });
const savedMark = async (date: string, cand: string) =>
  ctx.db
    .selectFrom('attendance_records as r')
    .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
    .select(['r.status', 'r.client_captured_at', 'r.captured_by'])
    .where('s.batch_id', '=', ctx.ids.batchA!)
    .where('s.session_date', '=', date)
    .where('r.candidate_id', '=', cand)
    .executeTakeFirst();

describe('TR-09 offline snapshot: only the batch essentials', () => {
  it('a trainer gets only their own active batches, with names, IDs and saved attendance', async () => {
    const res = await c.trainerA!.get('/trainer/offline-snapshot');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe('2026-10-26');
    // batchDone is completed, so only the running batch is kept.
    expect(res.body.batches.map((b: { id: string }) => b.id)).toEqual([ctx.ids.batchA]);
    const b = res.body.batches[0];
    expect(b).toMatchObject({ name: '2W Peenya October 2026', centreName: expect.any(String), courseName: expect.any(String), startDate: '2026-10-12' });
    expect(b.people).toHaveLength(4);
    expect(Object.keys(b.people[0]).sort()).toEqual(['candidateId', 'code', 'locked', 'name']);
    expect(b.marks.length).toBe(24); // six sessions × four people in the demo data
  });

  it('never includes phone numbers, email, dates of birth or addresses', async () => {
    const text = JSON.stringify((await c.trainerA!.get('/trainer/offline-snapshot')).body);
    expect(text).not.toMatch(/\+91|@|date_?of_?birth|dob|address|phone|email/i);
  });

  it('a trainer with no running batch gets an empty list; other roles cannot ask', async () => {
    expect((await c.trainerB!.get('/trainer/offline-snapshot')).body.batches).toEqual([]); // batchB is planned
    expect((await c.opsAdmin!.get('/trainer/offline-snapshot')).status).toBe(403);
    expect((await c.partnerAdminA!.get('/trainer/offline-snapshot')).status).toBe(403);
  });
});

describe('TR-04 offline attendance sync', () => {
  it('saves queued marks with the time they were taken on the phone, and audits them', async () => {
    const taken = new Date(Date.now() - 60 * 60_000).toISOString(); // an hour ago, while offline
    const ops = [
      op({ candidateId: ctx.ids.learner, status: 'present', capturedAt: taken }),
      op({ candidateId: ctx.ids.cand1, status: 'late', capturedAt: taken }),
      op({ candidateId: ctx.ids.cand3, status: 'absent', capturedAt: taken }),
    ];
    const res = await sync(c.trainerA!, ops);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['applied', 'applied', 'applied']);
    expect(res.body.results.map((r: { opId: string }) => r.opId)).toEqual(ops.map((o) => o.opId));
    const mark = await savedMark('2026-10-23', ctx.ids.cand1!);
    expect(mark).toMatchObject({ status: 'late', captured_by: ctx.ids.trainerA });
    expect(mark!.client_captured_at!.toISOString()).toBe(taken);
    const ev = await ctx.db.selectFrom('audit_events').select(['actor_id', 'entity_id', 'after']).where('action', '=', 'attendance.synced').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ actor_id: ctx.ids.trainerA, entity_id: ctx.ids.batchA });
    expect((ev.after as { marks: unknown[] }).marks).toHaveLength(3);
  });

  it('sending the same changes again (a retry after a dropped connection) is harmless', async () => {
    const first = op({ date: '2026-10-24', candidateId: ctx.ids.cand2, status: 'absent' });
    expect((await sync(c.trainerA!, [first])).body.results[0].outcome).toBe('applied');
    // A later change overwrites it; then the first one arrives again. It must not undo the later one.
    const later = op({ date: '2026-10-24', candidateId: ctx.ids.cand2, status: 'present' });
    expect((await sync(c.trainerA!, [later])).body.results[0].outcome).toBe('applied');
    expect((await sync(c.trainerA!, [first, later])).body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['duplicate', 'duplicate']);
    expect((await savedMark('2026-10-24', ctx.ids.cand2!))!.status).toBe('present');
  });

  it('a mark that matches what is saved is reported unchanged', async () => {
    const res = await sync(c.trainerA!, [op({ date: '2026-10-24', candidateId: ctx.ids.cand2, status: 'present' })]);
    expect(res.body.results[0].outcome).toBe('unchanged');
  });

  it('conflict: a mark saved after the phone took its own is kept, and the phone is told what is saved', async () => {
    // Saved online now…
    const online = await c.trainerA!.put(`/batches/${ctx.ids.batchA}/attendance`, { date: '2026-10-22', marks: [{ candidateId: ctx.ids.cand3!, status: 'present' }] });
    expect(online.status).toBe(200);
    // …then a mark taken offline two hours ago arrives.
    const old = op({ date: '2026-10-22', candidateId: ctx.ids.cand3, status: 'absent', capturedAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const res = await sync(c.trainerA!, [old]);
    expect(res.body.results[0]).toMatchObject({ outcome: 'conflict', server: { status: 'present' } });
    expect((await savedMark('2026-10-22', ctx.ids.cand3!))!.status).toBe('present');

    // Retrying the same change gives the same answer (the phone may have missed it).
    expect((await sync(c.trainerA!, [old])).body.results[0].outcome).toBe('conflict');

    // The trainer chooses "use my mark": a new change with force.
    const keepMine = op({ date: '2026-10-22', candidateId: ctx.ids.cand3, status: 'absent', force: true });
    expect((await sync(c.trainerA!, [keepMine])).body.results[0].outcome).toBe('applied');
    expect((await savedMark('2026-10-22', ctx.ids.cand3!))!.status).toBe('absent');
  });

  it('a newer change on the phone replaces an older saved mark (no conflict)', async () => {
    const res = await sync(c.trainerA!, [op({ date: '2026-10-22', candidateId: ctx.ids.cand3, status: 'late' })]);
    expect(res.body.results[0].outcome).toBe('applied');
  });

  it('a phone clock set in the future does not let a change win every conflict', async () => {
    const future = op({ date: '2026-10-20', candidateId: ctx.ids.cand1, status: 'absent', capturedAt: '2027-06-01T09:00:00.000Z' });
    expect((await sync(c.trainerA!, [future])).body.results[0].outcome).toBe('applied');
    const mark = await savedMark('2026-10-20', ctx.ids.cand1!);
    expect(mark!.client_captured_at!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('changes that can never be saved are rejected one by one, while the rest are saved', async () => {
    const good = op({ date: '2026-10-25', candidateId: ctx.ids.learner, status: 'present' });
    const future = op({ date: '2026-10-30' });
    const outside = op({ date: '2026-10-01' });
    const notEnrolled = op({ candidateId: ctx.ids.cand5 });
    const closed = op({ batchId: ctx.ids.batchDone, date: '2026-09-01', candidateId: ctx.ids.cand1 });
    const res = await sync(c.trainerA!, [good, future, outside, notEnrolled, closed]);
    const [a, b, d, e, f] = res.body.results;
    expect(a.outcome).toBe('applied');
    expect(b).toMatchObject({ outcome: 'rejected', message: expect.stringMatching(/future date/) });
    expect(d).toMatchObject({ outcome: 'rejected', message: expect.stringMatching(/outside the batch dates/) });
    expect(e).toMatchObject({ outcome: 'rejected', message: expect.stringMatching(/not enrolled/) });
    expect(f).toMatchObject({ outcome: 'rejected', message: expect.stringMatching(/completed; attendance is closed/) });
    // Retried rejections are rejected again without anything being saved.
    expect((await sync(c.trainerA!, [future])).body.results[0].outcome).toBe('rejected');
  });

  it('attendance is locked once results are submitted', async () => {
    const enrolment = await ctx.db.selectFrom('enrolments').select('id').where('batch_id', '=', ctx.ids.batchA!).where('candidate_id', '=', ctx.ids.cand2!).executeTakeFirstOrThrow();
    await ctx.db
      .insertInto('assessment_results')
      .values({ id: randomUUID(), enrolment_id: enrolment.id, status: 'submitted', total_score: 70, max_score: 100, outcome: 'pass', recorded_by: ctx.ids.trainerA!, submitted_by: ctx.ids.trainerA!, submitted_at: new Date() })
      .execute();
    const res = await sync(c.trainerA!, [op({ date: '2026-10-25', candidateId: ctx.ids.cand2, status: 'absent' })]);
    expect(res.body.results[0]).toMatchObject({ outcome: 'rejected', message: expect.stringMatching(/attendance is locked/) });
    const snap = await c.trainerA!.get('/trainer/offline-snapshot');
    expect(snap.body.batches[0].people.find((p: { candidateId: string }) => p.candidateId === ctx.ids.cand2).locked).toBe(true);
  });

  it('another trainer’s batch is rejected with the same answer as a batch that does not exist', async () => {
    const theirs = await sync(c.trainerVta!, [op()]);
    const unknown = await sync(c.trainerA!, [op({ batchId: randomUUID() })]);
    expect(theirs.body.results[0]).toEqual({ opId: expect.any(String), outcome: 'rejected', message: 'This batch is not assigned to you.' });
    expect(unknown.body.results[0].message).toBe(theirs.body.results[0].message);
  });

  it('a change id used by another trainer is not treated as theirs', async () => {
    const mine = op({ date: '2026-10-25', candidateId: ctx.ids.cand3, status: 'present' });
    expect((await sync(c.trainerA!, [mine])).body.results[0].outcome).not.toBe('rejected');
    const res = await sync(c.trainerVta!, [{ ...mine, batchId: ctx.ids.batchA }]);
    expect(res.body.results[0]).toMatchObject({ outcome: 'rejected', message: 'This change id was already used.' });
  });

  it('only trainers may sync; the request needs the CSRF token; limits are enforced', async () => {
    expect((await sync(c.opsAdmin!, [op()])).status).toBe(403);
    expect((await sync(c.partnerAdminA!, [op()])).status).toBe(403);
    expect((await c.trainerA!.post('/sync/attendance', { ops: [op()] }, { csrf: null })).status).toBe(403);
    expect((await sync(c.trainerA!, [])).status).toBe(400);
    const same = op();
    expect((await sync(c.trainerA!, [same, same])).status).toBe(400);
    expect((await sync(c.trainerA!, Array.from({ length: SYNC_MAX_OPS + 1 }, () => op()))).status).toBe(400);
    expect((await sync(c.trainerA!, [op({ status: 'maybe' })])).status).toBe(400);
  });
});
