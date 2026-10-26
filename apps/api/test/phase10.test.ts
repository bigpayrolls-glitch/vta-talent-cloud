import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 10 fixes found in the pilot-readiness review. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

beforeAll(async () => {
  ctx = await setup();
  c.ops = await loginEmail(ctx, EMAIL.opsAdmin);
  c.centre = await loginEmail(ctx, EMAIL.centreAdmin);
  c.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

describe('AD-05 document verification', () => {
  let learnerId = '';
  let docA = '';
  let docB = '';

  it('VTA verifies a learner document; the learner can then no longer delete it', async () => {
    learnerId = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    docA = (await c.learner!.upload('/me/documents?kind=certificate&title=ITI%20certificate&fileName=iti.pdf', PDF)).body.id;
    docB = (await c.learner!.upload('/me/documents?kind=other&title=Blurry%20photo&fileName=b.pdf', PDF)).body.id;

    const ok = await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docA}/review`, { decision: 'verified' });
    expect(ok.body).toEqual({ id: docA, verificationStatus: 'verified' });
    const mine = (await c.learner!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docA);
    expect(mine).toMatchObject({ verificationStatus: 'verified', canDelete: false, reviewReason: null });
    expect((await c.learner!.del(`/me/documents/${docA}`)).status).toBe(403);
    expect((await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docA}/review`, { decision: 'verified' })).status).toBe(400);
  });

  it('rejecting needs a reason, which the learner sees and is notified about', async () => {
    const noReason = await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'rejected' });
    expect(noReason.body.error.fields.reason).toBe('Give a reason');
    await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'rejected', reason: 'The photo is too blurry to read' });
    const mine = (await c.learner!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docB);
    expect(mine).toMatchObject({ verificationStatus: 'rejected', reviewReason: 'The photo is too blurry to read', canDelete: true });
    const n = (await c.learner!.get('/notifications')).body.items[0];
    expect(n).toMatchObject({ title: 'VTA could not accept "Blurry photo"', link: '/learn/documents' });
    const detail = (await c.ops!.get(`/admin/candidates/${learnerId}`)).body.documents.find((d: { id: string }) => d.id === docB);
    expect(detail.reviewReason).toBe('The photo is too blurry to read');
    const logged = await ctx.db.selectFrom('audit_events').select('action').where('entity_id', '=', learnerId).where('action', 'in', ['document.verified', 'document.rejected']).execute();
    expect(logged.map((l) => l.action).sort()).toEqual(['document.rejected', 'document.verified']);
  });

  it('only VTA operations can review; a document must belong to that candidate', async () => {
    expect((await c.centre!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'verified' })).status).toBe(403);
    const other = (await ctx.db.selectFrom('candidate_profiles').select('user_id').where('user_id', '!=', learnerId).executeTakeFirstOrThrow()).user_id;
    expect((await c.ops!.post(`/admin/candidates/${other}/documents/${docB}/review`, { decision: 'verified' })).status).toBe(404);
  });
});
