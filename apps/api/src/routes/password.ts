import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../app.js';
import { audit } from '../audit/service.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { dummyPasswordCheck, hashPassword, isCommonPassword, newId, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { ApiError, invalid } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const RESET_TTL_MINUTES = 30;
const RESETS_PER_HOUR = 3;
const GONE = 'This link is invalid, already used or expired. Ask for a new one.';

/**
 * Phase 9: password reset by email link, and password change while signed in (email/password accounts:
 * VTA staff, employers and partners; learners and trainers sign in with phone codes and have no password).
 */
export const passwordRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const link = (token: string) => `${app.config.APP_ORIGIN}/reset-password/${token}`;

  /** Same reply whether or not the email has an account. */
  app.post('/password/forgot', { config: { public: true, rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const done = (token?: string) => ({ ok: true, ...(app.config.showCodes && token ? { stagingLink: link(token) } : {}) });
    const user = await db.selectFrom('users').select(['id', 'name', 'status', 'password_hash']).where('email', '=', email).executeTakeFirst();
    // Only active accounts that use a password; an invited person uses their invitation link instead.
    if (!user || user.status !== 'active' || !user.password_hash) return done();
    const recent = await db
      .selectFrom('password_resets')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('user_id', '=', user.id)
      .where('created_at', '>', new Date(Date.now() - 3600_000))
      .executeTakeFirstOrThrow();
    if (Number(recent.n) >= RESETS_PER_HOUR) return done(); // quietly: no more emails this hour
    const token = randomToken();
    await db.transaction().execute(async (trx) => {
      // A new link replaces any earlier one.
      await trx.updateTable('password_resets').set({ expires_at: new Date() }).where('user_id', '=', user.id).where('used_at', 'is', null).where('expires_at', '>', new Date()).execute();
      await trx.insertInto('password_resets').values({ id: newId(), user_id: user.id, token_hash: sha256(token), expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) }).execute();
      await audit(trx, auditCtx(req), { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
    });
    await app.providers.email.sendPasswordReset(email, user.name, link(token));
    return done(token);
  });

  const findReset = async (token: string) => {
    const r = await db
      .selectFrom('password_resets as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'r.user_id', 'r.expires_at', 'r.used_at', 'u.status', 'u.email'])
      .where('r.token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!r || r.used_at || r.expires_at < new Date() || r.status !== 'active') throw new ApiError('NOT_FOUND', GONE);
    return r;
  };
  const tokenParam = z.object({ token: z.string().min(20).max(100) });

  /** Lets the page say "this link has expired" before the person types a new password. */
  app.get('/password/reset/:token', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const r = await findReset(parse(tokenParam, req.params).token);
    return { email: r.email };
  });

  app.post('/password/reset', { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(resetPasswordSchema, req.body);
    if (isCommonPassword(b.password)) throw invalid('Choose a less common password', { password: 'This password is too common' });
    const r = await findReset(b.token);
    const passwordHash = await hashPassword(b.password);
    await db.transaction().execute(async (trx) => {
      const used = await trx.updateTable('password_resets').set({ used_at: new Date() }).where('id', '=', r.id).where('used_at', 'is', null).returning('id').executeTakeFirst();
      if (!used) throw new ApiError('NOT_FOUND', GONE);
      await trx.updateTable('users').set({ password_hash: passwordHash, failed_login_count: 0, locked_until: null, updated_at: new Date() }).where('id', '=', r.user_id).execute();
      await audit(trx, { ...auditCtx(req), actorId: r.user_id }, { action: 'auth.password_reset', entityType: 'user', entityId: r.user_id });
    });
    // Anyone signed in with the old password is signed out everywhere.
    await revokeUserSessions(db, r.user_id);
    return { ok: true };
  });

  app.post('/password/change', { config: { permission: 'self.read', rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(changePasswordSchema, req.body);
    const user = await db.selectFrom('users').select(['id', 'password_hash']).where('id', '=', req.actor!.userId).executeTakeFirstOrThrow();
    if (!user.password_hash) {
      await dummyPasswordCheck(b.currentPassword);
      throw invalid('This account signs in with a phone code and has no password.');
    }
    if (!(await verifyPassword(user.password_hash, b.currentPassword))) throw invalid('Your current password is not right', { currentPassword: 'Not right' });
    if (isCommonPassword(b.newPassword)) throw invalid('Choose a less common password', { newPassword: 'This password is too common' });
    const passwordHash = await hashPassword(b.newPassword);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: new Date() }).where('id', '=', user.id).execute();
      // Other devices are signed out; this one stays signed in.
      await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', user.id).where('id', '!=', req.actor!.sessionId).where('revoked_at', 'is', null).execute();
      await audit(trx, auditCtx(req), { action: 'auth.password_changed', entityType: 'user', entityId: user.id });
    });
    return { ok: true };
  });
};
