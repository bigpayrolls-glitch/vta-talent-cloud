import 'fake-indexeddb/auto';
import type { MeDto, OfflineSnapshot } from '@vta/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLocalMark, cachedMe, claimForUser, enqueue, expireOldRoster, readAll, saveSnapshot, wipeAll } from './store';
import { localToday } from './useOffline';

/** TR-04 queue rules and TR-09 data protection rules for what the phone keeps. */
const trainer = (id: string): MeDto => ({
  id,
  name: 'Prakash Trainer',
  email: 'not-kept@example.invalid',
  phone: '+919900000101',
  hasPassword: false,
  status: 'active',
  roles: [{ id: 'r1', role: 'trainer', organisationId: null, organisationName: null, centreId: 'c1', centreName: 'Peenya' }] as MeDto['roles'],
  portals: ['partner'],
  csrfToken: 'secret-token',
});
const snapshot: OfflineSnapshot = {
  today: '2026-10-26',
  generatedAt: '2026-10-26T04:00:00.000Z',
  batches: [
    {
      id: 'b1',
      name: '2W Peenya',
      courseName: '2W Service',
      centreName: 'Peenya',
      startDate: '2026-10-12',
      endDate: '2027-01-12',
      people: [{ candidateId: 'p1', name: 'Venkatesh', code: 'ATG26-1', locked: false }],
      marks: [],
    },
  ],
};
const change = (status: 'present' | 'absent') => ({ batchId: 'b1', batchName: '2W Peenya', date: '2026-10-26', candidateId: 'p1', candidateName: 'Venkatesh', status });

beforeEach(async () => {
  await wipeAll();
});

describe('offline store', () => {
  it('keeps a trainer’s details for opening offline, but never the CSRF token or email', async () => {
    await claimForUser(trainer('u1'));
    const me = await cachedMe();
    expect(me).toMatchObject({ id: 'u1', name: 'Prakash Trainer', email: null });
    expect(JSON.stringify(me)).not.toContain('secret-token');
  });

  it('deletes everything when a different person signs in on the phone', async () => {
    await claimForUser(trainer('u1'));
    await saveSnapshot(snapshot);
    await enqueue([change('present')]);
    await claimForUser(trainer('u2'));
    const d = await readAll();
    expect(d.batches).toEqual([]);
    expect(d.ops).toEqual([]);
    expect(d.meta.owner).toBe('u2');
  });

  it('keeps nothing for someone who is not a trainer', async () => {
    await claimForUser(trainer('u1'));
    await saveSnapshot(snapshot);
    await claimForUser({ ...trainer('u1'), roles: [] });
    expect(await cachedMe()).toBeNull();
    expect((await readAll()).batches).toEqual([]);
  });

  it('a newer change for the same person and date replaces the queued one', async () => {
    const [first] = await enqueue([change('present')]);
    const [second] = await enqueue([change('absent')]);
    const { ops } = await readAll();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ opId: second!.opId, status: 'absent', state: 'pending' });
    expect(second!.opId).not.toBe(first!.opId);
    expect(Date.parse(ops[0]!.capturedAt)).not.toBeNaN();
  });

  it('a saved change shows as saved in the roster copy', async () => {
    await saveSnapshot(snapshot);
    await applyLocalMark('b1', '2026-10-26', 'p1', 'late', '2026-10-26T05:00:00.000Z');
    await applyLocalMark('b1', '2026-10-26', 'p1', 'present', '2026-10-26T06:00:00.000Z');
    const { batches } = await readAll();
    expect(batches[0]!.marks).toEqual([{ date: '2026-10-26', candidateId: 'p1', status: 'present', capturedAt: '2026-10-26T06:00:00.000Z' }]);
  });

  it('a roster not refreshed for 14 days is deleted, but changes waiting to sync are kept', async () => {
    await saveSnapshot(snapshot);
    await enqueue([change('present')]);
    expect(await expireOldRoster(Date.now() + 13 * 86_400_000)).toBe(false);
    expect(await expireOldRoster(Date.now() + 15 * 86_400_000)).toBe(true);
    const d = await readAll();
    expect(d.batches).toEqual([]);
    expect(d.ops).toHaveLength(1);
  });

  it('sign-out wipe removes everything', async () => {
    await claimForUser(trainer('u1'));
    await saveSnapshot(snapshot);
    await enqueue([change('present')]);
    await wipeAll();
    const d = await readAll();
    expect(d).toEqual({ meta: {}, batches: [], ops: [] });
  });
});

describe('the app’s idea of today', () => {
  it('follows the server’s date and moves on with the days passed since the roster was fetched', () => {
    const meta = { serverToday: '2026-10-26', snapshotAt: '2026-10-26T04:00:00.000Z' };
    expect(localToday(meta, Date.parse('2026-10-26T12:00:00.000Z'))).toBe('2026-10-26');
    expect(localToday(meta, Date.parse('2026-10-28T04:00:00.000Z'))).toBe('2026-10-28');
  });
  it('uses India time when nothing is stored', () => {
    expect(localToday({}, Date.parse('2026-10-26T20:00:00.000Z'))).toBe('2026-10-27');
  });
});
