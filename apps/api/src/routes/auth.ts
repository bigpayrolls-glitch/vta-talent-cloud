import {
  acceptInvitationSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  NOTICE_VERSION,
  portalsForRoles,
  registerSchema,
  type MeDto,
} from '@vta/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../app.js';
import { audit } from '../audit/service.js';
import { createSession, revokeUserSessions, SESSION_COOKIE } from './../auth/sessions.js';
import {
  dummyPasswordCheck,
  hashPassword,
  isCommonPassword,
  newId,
  safeEqual,
  sha256,
  sixDigitCode,
  verifyPassword,
} from '../lib/crypto.js';
import { ApiError, invalid, unauthenticated } from '../lib/errors.js';
import { iso, parse } from '../lib/validate.js';
import { createSelfRegisteredCandidate, consentRequired } from './learner/service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_GAP_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;

const otpHash = (challengeId: string, code: string) => sha256(`${challengeId}:${code}`);

export const authRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const secure = app.config.COOKIE_SECURE;
  const ipLimit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

  /**
   * Checks a phone code and uses it up. Wrong codes count towards the 5 attempts; any failure looks the same
   * whether or not the number is registered. `purpose` limits which codes count (registration codes only for /register).
   */
  async function checkCode(phone: string, code: string, purpose?: 'register'): Promise<void> {
    let q = db
      .selectFrom('otp_challenges')
      .selectAll()
      .where('phone', '=', phone)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', new Date());
    if (purpose) q = q.where('purpose', '=', purpose);
    const challenge = await q.orderBy('created_at', 'desc').executeTakeFirst();
    const expired = invalid('This code has expired. Request a new one.', { code: 'Code expired' });
    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) throw expired;

    if (!safeEqual(challenge.code_hash, otpHash(challenge.id, code))) {
      const attempts = challenge.attempts + 1;
      await db
        .updateTable('otp_challenges')
        .set({ attempts, consumed_at: attempts >= OTP_MAX_ATTEMPTS ? new Date() : null })
        .where('id', '=', challenge.id)
        .execute();
      const left = OTP_MAX_ATTEMPTS - attempts;
      if (left <= 0) throw expired;
      throw invalid(`Incorrect code. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, { code: 'Incorrect code' });
    }
    await db.updateTable('otp_challenges').set({ consumed_at: new Date() }).where('id', '=', challenge.id).execute();
  }

  /** Signs in a phone user after their code is checked. First sign-in of an invited user activates the account. */
  async function signInByPhone(req: FastifyRequest, reply: FastifyReply, phone: string): Promise<void> {
    const user = await db.selectFrom('users').selectAll().where('phone', '=', phone).executeTakeFirst();
    if (!user) throw invalid('This code has expired. Request a new one.', { code: 'Code expired' });
    if (user.status === 'suspended') throw new ApiError('FORBIDDEN', 'This account is suspended. Contact AutoTalent Grid support.');
    if (user.status !== 'active' && user.status !== 'invited') throw unauthenticated('This account cannot sign in.');
    await db.transaction().execute(async (trx) => {
      if (user.status === 'invited') {
        await trx
          .updateTable('users')
          .set({ status: 'active', phone_verified_at: new Date(), updated_at: new Date() })
          .where('id', '=', user.id)
          .execute();
        await audit(trx, { ...auditCtx(req), actorId: user.id }, {
          action: 'user.activated', entityType: 'user', entityId: user.id,
          before: { status: 'invited' }, after: { status: 'active', via: 'otp' },
        });
      } else if (!user.phone_verified_at) {
        await trx.updateTable('users').set({ phone_verified_at: new Date() }).where('id', '=', user.id).execute();
      }
    });
    await createSession(db, req, reply, user.id, secure);
    await audit(db, { ...auditCtx(req), actorId: user.id }, { action: 'auth.login', entityType: 'user', entityId: user.id, after: { method: 'otp' } });
  }

  /** F-03: email + password sign-in for staff. Generic errors so emails cannot be discovered. */
  app.post('/login', { config: { public: true, ...ipLimit(20) } }, async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    if (!user) {
      await dummyPasswordCheck(password);
      throw unauthenticated('Email or password is incorrect');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new ApiError('RATE_LIMITED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    const ok = user.password_hash ? await verifyPassword(user.password_hash, password) : (await dummyPasswordCheck(password), false);
    if (!ok) {
      const failed = user.failed_login_count + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db
        .updateTable('users')
        .set({
          failed_login_count: lock ? 0 : failed,
          locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where('id', '=', user.id)
        .execute();
      if (lock) await audit(db, { ...auditCtx(req), actorId: null }, { action: 'auth.locked', entityType: 'user', entityId: user.id });
      throw unauthenticated('Email or password is incorrect');
    }
    if (user.status === 'suspended') throw new ApiError('FORBIDDEN', 'This account is suspended. Contact AutoTalent Grid support.');
    if (user.status !== 'active') throw unauthenticated('Email or password is incorrect');
    await createSession(db, req, reply, user.id, secure);
    await audit(db, { ...auditCtx(req), actorId: user.id }, { action: 'auth.login', entityType: 'user', entityId: user.id, after: { method: 'password' } });
    return { ok: true };
  });

  /** F-04: request a phone OTP. Same response whether or not the number is registered. */
  app.post('/otp/request', { config: { public: true, ...ipLimit(10) } }, async (req) => {
    const { phone, purpose } = parse(otpRequestSchema, req.body);
    const recent = await db
      .selectFrom('otp_challenges')
      .select(['created_at'])
      .where('phone', '=', phone)
      .where('created_at', '>', new Date(Date.now() - 3600_000))
      .orderBy('created_at', 'desc')
      .execute();
    const last = recent[0];
    if (last && Date.now() - new Date(last.created_at).getTime() < OTP_RESEND_GAP_SECONDS * 1000) {
      const wait = Math.ceil(OTP_RESEND_GAP_SECONDS - (Date.now() - new Date(last.created_at).getTime()) / 1000);
      throw new ApiError('RATE_LIMITED', `Please wait ${wait} seconds before requesting another code.`);
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      throw new ApiError('RATE_LIMITED', 'Too many codes requested. Try again in an hour.');
    }
    const user = await db
      .selectFrom('users')
      .select(['id'])
      .where('phone', '=', phone)
      .where('status', 'in', ['active', 'invited'])
      .executeTakeFirst();
    const id = newId();
    const code = sixDigitCode();
    // Registration (EE-01) sends a code to any number: the answer is the same whether or not it is registered,
    // so numbers cannot be checked here. Sign-in sends a code only to registered numbers.
    const send = purpose === 'register' || !!user;
    await db
      .insertInto('otp_challenges')
      .values({
        id,
        phone,
        // Unregistered numbers still get a challenge row (keeps the resend limit honest) but no SMS.
        code_hash: send ? otpHash(id, code) : 'unregistered',
        purpose,
        expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
        ip: req.ip,
      })
      .execute();
    if (send) await app.providers.sms.sendOtp(phone, code);
    return {
      ok: true,
      message: purpose === 'register' ? 'A code has been sent to this number.' : 'If this number is registered, a code has been sent.',
      expiresInSeconds: OTP_TTL_SECONDS,
      // Staging only (demo data, no SMS provider yet): the code is shown on screen instead of sent.
      ...(app.config.showCodes && send ? { stagingCode: code } : {}),
    };
  });

  /** F-04: verify the code and sign in. First sign-in of an invited phone user activates the account. */
  app.post('/otp/verify', { config: { public: true, ...ipLimit(20) } }, async (req, reply) => {
    const { phone, code } = parse(otpVerifySchema, req.body);
    await checkCode(phone, code);

    await signInByPhone(req, reply, phone);
    return { ok: true };
  });

  /**
   * EE-01: self-registration with a phone code. If the number already has an account, the person is simply
   * signed in (nothing about it is changed), so registering cannot be used to find out who is registered.
   */
  app.post('/register', { config: { public: true, ...ipLimit(10) } }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    await checkCode(input.phone, input.code, 'register');
    const existing = await db.selectFrom('users').select(['id']).where('phone', '=', input.phone).executeTakeFirst();
    if (existing) {
      await signInByPhone(req, reply, input.phone);
      return { ok: true, existing: true };
    }
    const id = await db.transaction().execute((trx) => createSelfRegisteredCandidate(trx, req, input));
    await createSession(db, req, reply, id, secure);
    await audit(db, { ...auditCtx(req), actorId: id }, { action: 'auth.login', entityType: 'user', entityId: id, after: { method: 'otp', registered: true } });
    reply.code(201);
    return { ok: true, existing: false, noticeVersion: NOTICE_VERSION };
  });

  app.post('/logout', { config: { permission: 'self.read' } }, async (req, reply) => {
    await db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', req.actor!.sessionId).execute();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Who am I: roles, portals and the CSRF token the web app sends on writes. */
  app.get('/me', { config: { permission: 'self.read' } }, async (req): Promise<MeDto> => {
    const actor = req.actor!;
    const user = await db.selectFrom('users').selectAll().where('id', '=', actor.userId).executeTakeFirstOrThrow();
    const roles = await db
      .selectFrom('role_assignments as ra')
      .leftJoin('organisations as o', 'o.id', 'ra.organisation_id')
      .leftJoin('centres as c', 'c.id', 'ra.centre_id')
      .select(['ra.id', 'ra.role', 'ra.organisation_id', 'o.legal_name', 'ra.centre_id', 'c.name as centre_name', 'ra.granted_at'])
      .where('ra.user_id', '=', actor.userId)
      .where('ra.revoked_at', 'is', null)
      .orderBy('ra.granted_at')
      .execute();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roles: roles.map((r) => ({
        id: r.id,
        role: r.role,
        organisationId: r.organisation_id,
        organisationName: r.legal_name,
        centreId: r.centre_id,
        centreName: r.centre_name,
        grantedAt: iso(r.granted_at)!,
      })),
      portals: portalsForRoles(actor.roles),
      csrfToken: actor.csrfToken,
      hasPassword: !!user.password_hash,
      // Learners must accept the current privacy notice and terms before using the Learner portal (SH-05).
      consentRequired: actor.roles.includes('learner') ? await consentRequired(db, actor.userId) : false,
    };
  });

  const tokenParam = z.object({ token: z.string().min(20).max(100) });

  async function findInvitation(token: string) {
    const inv = await db
      .selectFrom('invitations as i')
      .innerJoin('users as u', 'u.id', 'i.user_id')
      .select(['i.id', 'i.user_id', 'i.invited_by', 'i.expires_at', 'i.accepted_at', 'u.name', 'u.email', 'u.status'])
      .where('i.token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!inv || inv.accepted_at || inv.expires_at < new Date() || inv.status !== 'invited') {
      throw new ApiError('NOT_FOUND', 'This link is invalid or has expired. If you registered your organisation, register again to get a new link; otherwise ask whoever invited you.');
    }
    return inv;
  }

  app.get('/invitations/:token', { config: { public: true, ...ipLimit(30) } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const inv = await findInvitation(token);
    // A self-registration link (Phase 8) was "sent" by the person themselves: the page then says "confirm your email".
    const selfRegistered = inv.invited_by === inv.user_id;
    const org = selfRegistered
      ? await db
          .selectFrom('role_assignments as ra')
          .innerJoin('organisations as o', 'o.id', 'ra.organisation_id')
          .select(['o.legal_name', 'o.type'])
          .where('ra.user_id', '=', inv.user_id)
          .where('ra.revoked_at', 'is', null)
          .executeTakeFirst()
      : undefined;
    return { name: inv.name, email: inv.email, expiresAt: iso(inv.expires_at), selfRegistered, organisationName: org?.legal_name ?? null, organisationType: org?.type ?? null };
  });

  /** Accept an email invitation: set a password, activate, sign in. */
  app.post('/invitations/:token/accept', { config: { public: true, ...ipLimit(10) } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const { password } = parse(acceptInvitationSchema, req.body);
    if (isCommonPassword(password)) throw invalid('Choose a less common password', { password: 'This password is too common' });
    const inv = await findInvitation(token);
    const passwordHash = await hashPassword(password);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('invitations').set({ accepted_at: new Date() }).where('id', '=', inv.id).execute();
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, status: 'active', email_verified_at: new Date(), updated_at: new Date() })
        .where('id', '=', inv.user_id)
        .execute();
      await audit(trx, { ...auditCtx(req), actorId: inv.user_id }, {
        action: 'user.invitation_accepted', entityType: 'user', entityId: inv.user_id,
        before: { status: 'invited' }, after: { status: 'active' },
      });
    });
    await revokeUserSessions(db, inv.user_id);
    await createSession(db, req, reply, inv.user_id, secure);
    return { ok: true };
  });
};
