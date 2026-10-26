import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Jobs matching the learner's skill areas come first; every open job stays visible and open to apply. */
let ctx: Ctx;
let learner: Client;

beforeAll(async () => {
  ctx = await setup();
  learner = await loginPhone(ctx, PHONE.learner); // skill areas: 2W, 2 years' experience or less
});
afterAll(() => ctx.close());

describe('jobs recommended by skill area', () => {
  it('a two-wheeler learner sees 2W jobs first, then other jobs, with how each fits', async () => {
    const r = (await learner.get('/jobs')).body;
    expect(r.mySkillAreas).toEqual(['2W']);
    expect(r.matchTotal).toBe(1);
    expect(r.items.map((j: { skillArea: string; matchesSkills: boolean }) => [j.skillArea, j.matchesSkills])).toEqual([
      ['2W', true],
      ['4W', false],
    ]);
    expect(typeof r.items[0].meetsExperience).toBe('boolean');
  });

  it('a learner can still open and apply to a job outside their skill area', async () => {
    const j = (await learner.get(`/jobs/${ctx.ids.job4wB}`)).body;
    expect(j).toMatchObject({ skillArea: '4W', matchesSkills: false });
    const applied = await learner.post(`/jobs/${ctx.ids.job4wB}/apply`, { shareProfile: true });
    expect(applied.status).toBe(201);
  });

  it('adding 4W to the profile makes the 4W job a match; the skill filter still narrows the list', async () => {
    const id = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    await ctx.db.updateTable('candidate_profiles').set({ skill_areas: ['2W', '4W'] }).where('user_id', '=', id).execute();
    const r = (await learner.get('/jobs')).body;
    expect(r.matchTotal).toBe(2);
    expect(r.items.every((j: { matchesSkills: boolean }) => j.matchesSkills)).toBe(true);
    const only4w = (await learner.get('/jobs?skillArea=4W')).body;
    expect(only4w.items.map((j: { skillArea: string }) => j.skillArea)).toEqual(['4W']);
  });

  it('a learner with no skill areas sees every job, none marked as a match', async () => {
    const id = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    await ctx.db.updateTable('candidate_profiles').set({ skill_areas: [] }).where('user_id', '=', id).execute();
    const r = (await learner.get('/jobs')).body;
    expect(r).toMatchObject({ mySkillAreas: [], matchTotal: 0 });
    expect(r.items).toHaveLength(2);
    expect(r.items.some((j: { matchesSkills: boolean }) => j.matchesSkills)).toBe(false);
  });
});
