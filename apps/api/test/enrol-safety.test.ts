import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/lib/crypto.js';
import { up as removeMistaken } from '../src/db/migrations/0028_remove_mistaken_enrolments.js';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** 29 Oct 2026: withdrawing several candidates at once, and the one-time removal of mistaken enrolments. */
let ctx: Ctx;
let partner: Client;

beforeAll(async () => {
  ctx = await setup();
  partner = await loginEmail(ctx, EMAIL.partnerAdminA);
});
afterAll(() => ctx.close());

async function batchWith(name: string, n: number, at: Date) {
  const template = await ctx.db.selectFrom('batches').selectAll().where('id', '=', ctx.ids.batchOpen2w!).executeTakeFirstOrThrow();
  const id = newId();
  await ctx.db.insertInto('batches').values({ ...template, id, name, status: 'planned', capacity: 20 }).execute();
  const people = await ctx.db.selectFrom('candidate_profiles').select('user_id').limit(n).execute();
  const enrolments: string[] = [];
  for (const p of people) {
    const eid = newId();
    enrolments.push(eid);
    await ctx.db.insertInto('enrolments').values({ id: eid, candidate_id: p.user_id, batch_id: id, status: 'enrolled', enrolled_at: at, enrolled_by: ctx.ids.partnerAdminA }).execute();
  }
  return { id, enrolments };
}

describe('withdrawing candidates', () => {
  it('a training partner withdraws several candidates of its batch at once; it is logged', async () => {
    const b = await batchWith('Bulk withdraw test', 3, new Date());
    expect((await partner.post(`/admin/batches/${b.id}/withdraw`, { enrolmentIds: b.enrolments, reason: 'x' })).status).toBe(400);
    const r = await partner.post(`/admin/batches/${b.id}/withdraw`, { enrolmentIds: b.enrolments.slice(0, 2), reason: 'Added by mistake' });
    expect(r.body).toEqual({ withdrawn: 2 });
    const rows = await ctx.db.selectFrom('enrolments').select('status').where('batch_id', '=', b.id).execute();
    expect(rows.filter((x) => x.status === 'withdrawn')).toHaveLength(2);
    expect((await partner.post(`/admin/batches/${b.id}/withdraw`, { enrolmentIds: b.enrolments.slice(0, 1), reason: 'Again' })).status).toBe(400);
  });

  it('the one-time fix withdraws only that batch’s enrolments added on 29 Oct', async () => {
    const day = new Date('2026-10-29T09:00:00Z');
    const target = await batchWith('Jr Technician – Beginner Certification | Bengaluru | November 2026', 4, day);
    const other = await batchWith('Some other batch', 2, day);
    await removeMistaken(ctx.db as never);
    const t = await ctx.db.selectFrom('enrolments').select(['status', 'withdraw_reason']).where('batch_id', '=', target.id).execute();
    expect(t.every((x) => x.status === 'withdrawn' && x.withdraw_reason?.startsWith('Added by mistake'))).toBe(true);
    const o = await ctx.db.selectFrom('enrolments').select('status').where('batch_id', '=', other.id).execute();
    expect(o.every((x) => x.status === 'enrolled')).toBe(true);
    expect((await ctx.db.selectFrom('audit_events').select('id').where('request_id', '=', 'migration-0028').execute()).length).toBe(4);
  });
});
