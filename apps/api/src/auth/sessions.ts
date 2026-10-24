import { STAFF_ROLES, type Role } from '@vta/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { newId, randomToken, sha256 } from '../lib/crypto.js';
import type { Actor, Assignment } from '../policy/index.js';

export const SESSION_COOKIE = 'vta_session';

const HOUR = 3600;
const DAY = 24 * HOUR;
/** SEC-09: staff 12 h idle (7 days absolute); learners, trainers, partners 30 days idle and absolute. */
const STAFF = { idle: 12 * HOUR, absolute: 7 * DAY };
const PWA = { idle: 30 * DAY, absolute: 30 * DAY };

export async function activeAssignments(db: DB, userId: string): Promise<Assignment[]> {
  const rows = await db
    .selectFrom('role_assignments')
    .select(['role', 'organisation_id', 'centre_id'])
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  return rows.map((r) => ({ role: r.role, organisationId: r.organisation_id, centreId: r.centre_id }));
}

export async function createSession(
  db: DB,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  cookieSecure: boolean,
): Promise<void> {
  const roles: Role[] = (await activeAssignments(db, userId)).map((a) => a.role);
  const policy = roles.some((r) => STAFF_ROLES.includes(r)) ? STAFF : PWA;
  const token = randomToken();
  await db
    .insertInto('sessions')
    .values({
      id: newId(),
      user_id: userId,
      token_hash: sha256(token),
      csrf_token: randomToken(),
      idle_timeout_seconds: policy.idle,
      expires_at: new Date(Date.now() + policy.absolute * 1000),
      ip: req.ip,
      user_agent: req.headers['user-agent']?.slice(0, 300) ?? null,
    })
    .execute();
  await db
    .updateTable('users')
    .set({ last_login_at: new Date(), failed_login_count: 0, locked_until: null, updated_at: new Date() })
    .where('id', '=', userId)
    .execute();
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: policy.absolute,
  });
}

/** Resolves the cookie to an Actor, or null. Expired/idle sessions and non-active users get nothing. */
export async function resolveActor(db: DB, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id as sessionId', 's.csrf_token', 's.last_seen_at', 's.idle_timeout_seconds', 's.expires_at', 'u.id as userId', 'u.name', 'u.status'])
    .where('s.token_hash', '=', sha256(token))
    .where('s.revoked_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;
  const now = Date.now();
  const lastSeen = new Date(row.last_seen_at).getTime();
  const idleExpired = now - lastSeen > row.idle_timeout_seconds * 1000;
  if (idleExpired || row.expires_at.getTime() < now || row.status !== 'active') {
    await db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', row.sessionId).execute();
    return null;
  }
  // Touch at most once a minute to keep writes low.
  if (now - lastSeen > 60_000) {
    await db.updateTable('sessions').set({ last_seen_at: new Date() }).where('id', '=', row.sessionId).execute();
  }
  const assignments = await activeAssignments(db, row.userId);
  return {
    userId: row.userId,
    name: row.name,
    sessionId: row.sessionId,
    csrfToken: row.csrf_token,
    assignments,
    roles: [...new Set(assignments.map((a) => a.role))],
  };
}

export async function revokeUserSessions(db: DB, userId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}
