import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { up as fixExperience } from '../src/db/migrations/0030_fix_imported_experience.js';
import { EMAIL, loginEmail, setup, type Ctx } from './helpers.js';

/** 30 Oct 2026: imported experience over 10 years was months, not years. */
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

describe('imported experience correction', () => {
  it('turns imported figures over 120 months into that many months; others and edited ones stay', async () => {
    const admin = await loginEmail(ctx, EMAIL.secondAdmin);
    const csv = ['name,phone,city,experience_months', 'Big Years,9811100001,Pune,420', 'Fine Years,9811100002,Pune,60', 'Edited Big,9811100003,Pune,240'].join('\n');
    expect((await admin.post('/admin/candidates/import', { csv, commit: true })).status).toBe(200);
    const id = async (phone: string) => (await ctx.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow()).id;
    const edited = await id('+919811100003');
    expect((await admin.patch(`/admin/candidates/${edited}`, { experienceMonths: 250 })).status).toBe(200);
    await fixExperience(ctx.db as never);
    const exp = async (phone: string) => (await ctx.db.selectFrom('candidate_profiles').select('experience_months').where('user_id', '=', await id(phone)).executeTakeFirstOrThrow()).experience_months;
    expect(await exp('+919811100001')).toBe(35);
    expect(await exp('+919811100002')).toBe(60);
    expect(await exp('+919811100003')).toBe(250);
    expect((await ctx.db.selectFrom('audit_events').select('id').where('request_id', '=', 'migration-0030').execute()).length).toBeGreaterThanOrEqual(1);
  });
});
