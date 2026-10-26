import { OFFLINE_ROSTER_MAX_AGE_DAYS, type AttendanceOp, type AttendanceStatus, type MeDto, type OfflineBatch, type OfflineSnapshot } from '@vta/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * What a trainer's phone keeps for offline attendance (TR-04, TR-09), in IndexedDB.
 * - batches: the batch essentials from the server (names, candidate IDs, saved attendance).
 * - ops: attendance changes taken on the phone that the server has not accepted yet.
 * - kv: who this data belongs to, the trainer's own sign-in details for opening the app offline, sync times.
 * Nothing here is sent anywhere except this platform's own API. It is deleted on sign-out,
 * when a different person signs in on this phone, and (for the roster) after 14 days without a refresh.
 */

export type OpState = 'pending' | 'conflict' | 'rejected';
export interface QueuedOp extends AttendanceOp {
  /** batchId|date|candidateId: one queued change per person and date. */
  key: string;
  state: OpState;
  message?: string;
  server?: { status: AttendanceStatus; capturedAt: string };
  batchName: string;
  candidateName: string;
}

export type CachedMe = Omit<MeDto, 'csrfToken'>;

interface Meta {
  owner?: string;
  me?: CachedMe;
  /** Device time when the roster was last refreshed from the server. */
  snapshotAt?: string;
  /** The server's "today" at that moment (the app follows the server's date, not the phone's). */
  serverToday?: string;
  lastSyncAt?: string;
  lastError?: string | null;
}

interface OfflineDB extends DBSchema {
  kv: { key: keyof Meta; value: Meta[keyof Meta] };
  batches: { key: string; value: OfflineBatch };
  ops: { key: string; value: QueuedOp; indexes: { byKey: string } };
}

const DB_NAME = 'vta-offline';
let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function db(): Promise<IDBPDatabase<OfflineDB>> {
  dbPromise ??= openDB<OfflineDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('batches', { keyPath: 'id' });
      d.createObjectStore('ops', { keyPath: 'opId' }).createIndex('byKey', 'key');
    },
  });
  return dbPromise;
}

export const opKey = (batchId: string, date: string, candidateId: string) => `${batchId}|${date}|${candidateId}`;

// ---- change notifications (this tab and other open tabs) ----
type Listener = () => void;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('vta-offline') : null;
channel?.addEventListener('message', () => listeners.forEach((l) => l()));
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function changed() {
  listeners.forEach((l) => l());
  channel?.postMessage('changed');
}

// ---- reading ----
export interface OfflineData {
  meta: Meta;
  batches: OfflineBatch[];
  ops: QueuedOp[];
}

export async function readAll(): Promise<OfflineData> {
  const d = await db();
  const tx = d.transaction(['kv', 'batches', 'ops']);
  const [keys, values, batches, ops] = await Promise.all([tx.objectStore('kv').getAllKeys(), tx.objectStore('kv').getAll(), tx.objectStore('batches').getAll(), tx.objectStore('ops').getAll()]);
  const meta: Meta = {};
  keys.forEach((k, i) => ((meta as Record<string, unknown>)[k] = values[i]));
  ops.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return { meta, batches, ops };
}

async function setMeta(values: Partial<Meta>) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  for (const [k, v] of Object.entries(values)) await tx.store.put(v, k as keyof Meta);
  await tx.done;
}

// ---- who the data belongs to ----

/** Deletes everything this app keeps on the phone. */
export async function wipeAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['kv', 'batches', 'ops'], 'readwrite');
  await Promise.all([tx.objectStore('kv').clear(), tx.objectStore('batches').clear(), tx.objectStore('ops').clear()]);
  await tx.done;
  changed();
}

/**
 * Called after every successful sign-in check. A trainer's details are kept so the app opens offline;
 * if the data on this phone belongs to someone else, or this person is not a trainer, it is deleted.
 */
export async function claimForUser(me: MeDto): Promise<void> {
  const isTrainer = me.roles.some((r) => r.role === 'trainer');
  const { meta } = await readAll();
  if (meta.owner && (meta.owner !== me.id || !isTrainer)) await wipeAll();
  if (!isTrainer) return;
  // Never the CSRF token (fetched fresh when online) and not the email address.
  const kept: CachedMe = { id: me.id, name: me.name, email: null, phone: me.phone, status: me.status, roles: me.roles, portals: me.portals };
  await setMeta({ owner: me.id, me: kept });
  changed();
}

export async function cachedMe(): Promise<CachedMe | null> {
  const { meta } = await readAll();
  return meta.owner && meta.me?.id === meta.owner ? meta.me : null;
}

// ---- roster ----

export async function saveSnapshot(snap: OfflineSnapshot): Promise<void> {
  const d = await db();
  const tx = d.transaction(['batches', 'kv'], 'readwrite');
  await tx.objectStore('batches').clear();
  for (const b of snap.batches) await tx.objectStore('batches').put(b);
  await tx.objectStore('kv').put(new Date().toISOString(), 'snapshotAt');
  await tx.objectStore('kv').put(snap.today, 'serverToday');
  await tx.done;
  changed();
}

/** TR-09: a roster not refreshed for 14 days is deleted. Changes still waiting to sync are kept. */
export async function expireOldRoster(now = Date.now()): Promise<boolean> {
  const { meta, batches } = await readAll();
  if (!meta.snapshotAt || batches.length === 0) return false;
  if (now - Date.parse(meta.snapshotAt) < OFFLINE_ROSTER_MAX_AGE_DAYS * 86_400_000) return false;
  const d = await db();
  await d.clear('batches');
  changed();
  return true;
}

/** After the server accepts a change, show it as saved on the phone too. */
export async function applyLocalMark(batchId: string, date: string, candidateId: string, status: AttendanceStatus, capturedAt: string) {
  const d = await db();
  const b = await d.get('batches', batchId);
  if (!b) return;
  b.marks = [...b.marks.filter((m) => !(m.date === date && m.candidateId === candidateId)), { date, candidateId, status, capturedAt }];
  await d.put('batches', b);
}

// ---- queued changes ----

export async function enqueue(changes: { batchId: string; batchName: string; date: string; candidateId: string; candidateName: string; status: AttendanceStatus; force?: boolean }[]): Promise<QueuedOp[]> {
  const d = await db();
  const tx = d.transaction('ops', 'readwrite');
  const now = new Date().toISOString();
  const added: QueuedOp[] = [];
  for (const c of changes) {
    const key = opKey(c.batchId, c.date, c.candidateId);
    // A newer change for the same person and date replaces the queued one.
    for (const old of await tx.store.index('byKey').getAllKeys(key)) await tx.store.delete(old);
    const op: QueuedOp = { ...c, opId: crypto.randomUUID(), capturedAt: now, key, state: 'pending' };
    if (!c.force) delete op.force;
    await tx.store.put(op);
    added.push(op);
  }
  await tx.done;
  changed();
  return added;
}

export async function removeOps(opIds: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('ops', 'readwrite');
  for (const id of opIds) await tx.store.delete(id);
  await tx.done;
  changed();
}

export async function updateOp(opId: string, patch: Partial<QueuedOp>): Promise<void> {
  const d = await db();
  const op = await d.get('ops', opId);
  if (!op) return;
  await d.put('ops', { ...op, ...patch });
}

export async function recordSync(values: { lastSyncAt?: string; lastError?: string | null }) {
  await setMeta(values);
  changed();
}

export const notifyChanged = changed;

/** For tests only: forget the open connection. */
export function _resetForTests() {
  dbPromise = null;
}
