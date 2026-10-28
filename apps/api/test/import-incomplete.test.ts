import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, setup, type Client, type Ctx } from './helpers.js';

/** 29 Oct 2026: bulk import of older lists without date of birth or city; the learner adds them at first sign-in. */
let ctx: Ctx;
let admin: Client;
beforeAll(async () => {
  ctx = await setup();
  admin = await loginEmail(ctx, EMAIL.secondAdmin);
});
afterAll(() => ctx.close());

describe('importing candidates without date of birth or city', () => {
  it('only name and phone are required; missing details are noted, not refused', async () => {
    const csv = ['name,phone,city', 'Kamal Mechanic,9066699111,', 'Manjunath R,9845994999,Bengaluru', 'No Phone,,Mysuru'].join('\n');
    const check = await admin.post('/admin/candidates/import', { csv });
    expect(check.body.summary).toEqual({ total: 3, ready: 2, possibleDuplicates: 0, errors: 1 });
    expect(check.body.rows[0].messages).toEqual(['No date of birth or city: they add it when they first sign in.']);
    expect(check.body.rows[1].messages).toEqual(['No date of birth: they add it when they first sign in.']);
    const done = await admin.post('/admin/candidates/import', { csv, commit: true });
    expect(done.body.imported).toBe(2);
    const kamal = await ctx.db.selectFrom('users as u').innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id').select(['u.id', 'u.date_of_birth', 'cp.city']).where('u.phone', '=', '+919066699111').executeTakeFirstOrThrow();
    expect(kamal).toMatchObject({ date_of_birth: null, city: null });
    // An Admin cannot verify them until the details are there.
    const v = await admin.post(`/admin/candidates/${kamal.id}/verify`);
    expect(v.status).toBe(400);
    expect(v.body.error.message).toMatch(/no date of birth or city/);
  });

  it('at first sign-in the learner adds them before enrolling or applying', async () => {
    const me = await loginPhone(ctx, '+919066699111');
    for (const purpose of ['privacy_notice', 'terms']) await me.post('/me/consents', { purpose, granted: true, noticeVersion: NOTICE_VERSION });
    expect((await me.get('/auth/me')).body).toMatchObject({ consentRequired: false, basicsRequired: true });
    expect((await me.post(`/jobs/${ctx.ids.job4wB}/apply`, { shareProfile: true })).body.error.message).toBe('Add your date of birth and city first.');
    expect((await me.get(`/me/enrol/${ctx.ids.batchOpen2w}`)).body.blocker).toBe('Add your date of birth and city first (in Profile).');
    const young = await me.post('/me/basics', { dateOfBirth: '2012-01-01', city: 'Bengaluru' });
    expect(young.body.error.fields.dateOfBirth).toMatch(/18 or older/);
    expect((await me.post('/me/basics', { dateOfBirth: '1996-04-12', city: 'Bengaluru' })).status).toBe(200);
    expect((await me.get('/auth/me')).body.basicsRequired).toBe(false);
    expect((await me.get(`/me/enrol/${ctx.ids.batchOpen2w}`)).body.blocker).toBeNull();
    expect((await me.post('/me/basics', { dateOfBirth: '1996-04-12', city: 'Mysuru' })).status).toBe(409);
    const audit = await ctx.db.selectFrom('audit_events').select(['after']).where('action', '=', 'candidate.basics_added').executeTakeFirstOrThrow();
    expect(audit.after).toMatchObject({ date_of_birth: '1996-04-12', city: 'Bengaluru' });
  });

  it('two rows with the same email: the second is skipped, nothing fails', async () => {
    const csv = ['name,phone,email', 'Ravi One,9811100001,same@example.com', 'Ravi Two,9811100002,SAME@example.com'].join('\n');
    const r = await admin.post('/admin/candidates/import', { csv, commit: true });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1);
    expect(r.body.rows[1].messages).toEqual(['email: Same email as row 2']);
  });

  it('a large file (2,500 rows) imports in one go, in chunks', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => `Bulk ${i},${8800000000 + i}`);
    const r = await admin.post('/admin/candidates/import', { csv: ['name,phone', ...rows].join('\n'), commit: true });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(2500);
    const n = await ctx.db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).where('phone', 'like', '+91880000%').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(2500);
  });
});
