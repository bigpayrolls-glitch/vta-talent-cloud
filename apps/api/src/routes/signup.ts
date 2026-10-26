import { NOTICE_VERSION, orgSignupSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { auditCtx } from '../app.js';
import { audit } from '../audit/service.js';
import type { DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { parse } from '../lib/validate.js';
import { createInvitation } from './admin/users.js';
import { findDuplicateOrg } from './hiring/company.js';
import { recordConsent } from './learner/service.js';

/**
 * Phase 8 (EM-01, PA-01): an employer or training partner registers its organisation from the public site.
 *
 * - Creates the organisation (pending, not yet sent to VTA), one admin account (not active) and an email link.
 *   The link confirms the email and sets a password, then the person completes the profile and documents and
 *   sends it to VTA for checking, as for an organisation VTA added.
 * - The reply is the same whether or not the email is already in use, so the form cannot be used to find out
 *   who has an account. Someone who registers again before confirming gets a fresh link.
 * - Nothing becomes visible to learners or other organisations until VTA verifies the organisation.
 */
export const signupRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const link = (token: string) => `${app.config.APP_ORIGIN}/invite/${token}`;

  app.post('/public/organisations/register', { config: { public: true, rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(orgSignupSchema, req.body);
    reply.code(202);
    const done = (token?: string) => ({ ok: true, ...(app.config.showCodes && token ? { stagingLink: link(token) } : {}) });

    // A filled-in hidden field: almost certainly a bot. Same reply, nothing stored.
    if (b.nickname) return done();

    const existing = await db.selectFrom('users').select(['id', 'name', 'status']).where('email', '=', b.email).executeTakeFirst();

    // A sign-up closed by the maintenance job (never confirmed) is reopened with the new details.
    if (existing?.status === 'deactivated') {
      const expired = await db
        .selectFrom('role_assignments as ra')
        .innerJoin('organisations as o', 'o.id', 'ra.organisation_id')
        .select(['o.id', 'ra.id as assignment_id'])
        .where('ra.user_id', '=', existing.id)
        .where('o.registration_source', '=', 'self')
        .where('o.status', '=', 'inactive')
        .where('o.submitted_at', 'is', null)
        .where('o.verification_reason', 'like', 'Email not confirmed within%')
        .executeTakeFirst();
      if (!expired) return done();
      let token = '';
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('organisations')
          .set({
            type: b.type,
            partner_subtype: b.type === 'partner' ? (b.partnerSubtype ?? null) : null,
            sector: b.type === 'employer' ? (b.sector ?? null) : null,
            legal_name: b.legalName,
            city: b.city,
            contact_name: b.contactName,
            contact_phone: b.phone,
            verification_status: 'pending',
            verification_reason: null,
            status: 'active',
            duplicate_of: await findDuplicateOrg(trx as unknown as DB, expired.id, b.legalName, undefined, b.type),
            updated_at: new Date(),
          })
          .where('id', '=', expired.id)
          .execute();
        await trx.updateTable('role_assignments').set({ role: b.type === 'employer' ? 'employer_admin' : 'partner_admin' }).where('id', '=', expired.assignment_id).execute();
        await trx.updateTable('users').set({ status: 'invited', name: b.contactName, updated_at: new Date() }).where('id', '=', existing.id).execute();
        for (const purpose of ['privacy_notice', 'terms'] as const) {
          await recordConsent(trx, { userId: existing.id, purpose, granted: true, noticeVersion: NOTICE_VERSION, source: 'self', recordedBy: existing.id });
        }
        await audit(trx, auditCtx(req), { action: 'organisation.signup_reopened', entityType: 'organisation', entityId: expired.id, after: { userId: existing.id, legal_name: b.legalName } });
        token = await createInvitation(trx as unknown as DB, existing.id, existing.id);
      });
      await app.providers.email.sendSignupConfirmation(b.email, b.contactName, link(token));
      return done(token);
    }

    if (existing) {
      // Only an unconfirmed self-registration gets a new link; any other account is left alone.
      const pending = await db
        .selectFrom('role_assignments as ra')
        .innerJoin('organisations as o', 'o.id', 'ra.organisation_id')
        .select('o.id')
        .where('ra.user_id', '=', existing.id)
        .where('ra.revoked_at', 'is', null)
        .where('o.registration_source', '=', 'self')
        .where('o.verification_status', '!=', 'verified')
        .executeTakeFirst();
      if (existing.status !== 'invited' || !pending) return done();
      const token = await createInvitation(db, existing.id, existing.id);
      await audit(db, auditCtx(req), { action: 'organisation.signup_link_resent', entityType: 'organisation', entityId: pending.id, after: { userId: existing.id } });
      await app.providers.email.sendSignupConfirmation(b.email, existing.name, link(token));
      return done(token);
    }

    const orgId = newId();
    const userId = newId();
    const duplicateOf = await findDuplicateOrg(db, orgId, b.legalName, undefined, b.type);
    let token = '';
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('organisations')
        .values({
          id: orgId,
          type: b.type,
          partner_subtype: b.type === 'partner' ? (b.partnerSubtype ?? null) : null,
          sector: b.type === 'employer' ? (b.sector ?? null) : null,
          legal_name: b.legalName,
          city: b.city,
          registration_ids: JSON.stringify({}),
          contact_name: b.contactName,
          contact_email: b.email,
          contact_phone: b.phone,
          verification_status: 'pending',
          status: 'active',
          registration_source: 'self',
          duplicate_of: duplicateOf,
        })
        .execute();
      await trx.insertInto('users').values({ id: userId, name: b.contactName, email: b.email, status: 'invited' }).execute();
      await trx
        .insertInto('role_assignments')
        .values({ id: newId(), user_id: userId, role: b.type === 'employer' ? 'employer_admin' : 'partner_admin', organisation_id: orgId, granted_by: null })
        .execute();
      for (const purpose of ['privacy_notice', 'terms'] as const) {
        await recordConsent(trx, { userId, purpose, granted: true, noticeVersion: NOTICE_VERSION, source: 'self', recordedBy: userId });
      }
      await audit(trx, auditCtx(req), {
        action: 'organisation.self_registered',
        entityType: 'organisation',
        entityId: orgId,
        after: { type: b.type, legal_name: b.legalName, city: b.city, admin_user_id: userId, duplicate_of: duplicateOf },
      });
      token = await createInvitation(trx as unknown as DB, userId, userId);
    });
    await app.providers.email.sendSignupConfirmation(b.email, b.contactName, link(token));
    return done(token);
  });
};
