import { companyProfileSchema, DOCUMENT_KINDS, inviteRecruiterSchema, UPLOAD_MAX_BYTES, UPLOAD_TYPES, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { notify, vtaReviewers } from '../../lib/notify.js';
import type { DB } from '../../db/index.js';
import type { Organisation } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { LINK_TTL_SECONDS, safeFileName, signLink, sniffMime } from '../../lib/storage.js';
import { iso, parse } from '../../lib/validate.js';
import { createInvitation } from '../admin/users.js';
import { employerOrg, employerOrgId } from './common.js';

const idParam = z.object({ id: uuidSchema });
const MAX_COMPANY_DOCUMENTS = 10;

export function companyDto(o: Organisation) {
  const reg = (typeof o.registration_ids === 'string' ? JSON.parse(o.registration_ids) : o.registration_ids) as Record<string, string>;
  return {
    id: o.id,
    legalName: o.legal_name,
    sector: o.sector,
    city: o.city,
    address: o.address,
    website: o.website,
    description: o.description,
    gstin: reg.gstin ?? null,
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    contactPhone: o.contact_phone,
    verificationStatus: o.verification_status,
    // Shown to the employer when VTA asks for more information or rejects.
    verificationReason: ['more_info_needed', 'rejected'].includes(o.verification_status) ? o.verification_reason : null,
    submittedAt: iso(o.submitted_at),
    verifiedAt: iso(o.verified_at),
    // Legal name and GSTIN are what VTA checks; after verification only VTA can change them.
    identityLocked: o.verification_status === 'verified',
    possibleDuplicate: !!o.duplicate_of,
  };
}

/** Another organisation of the same type with the same GSTIN or the same name (ignoring case and spacing): flag for VTA (EM-01). */
export async function findDuplicateOrg(db: DB, id: string, legalName: string, gstin?: string, type: 'employer' | 'partner' = 'employer'): Promise<string | null> {
  const norm = legalName.trim().replace(/\s+/g, ' ').toLowerCase();
  const row = await db
    .selectFrom('organisations')
    .select('id')
    .where('id', '!=', id)
    .where('type', '=', type)
    .where((eb) =>
      eb.or([
        eb(sql`lower(regexp_replace(trim(legal_name), '\\s+', ' ', 'g'))`, '=', norm),
        ...(gstin ? [eb(sql`registration_ids->>'gstin'`, '=', gstin)] : []),
      ]),
    )
    .orderBy('created_at')
    .executeTakeFirst();
  return row?.id ?? null;
}

/** EM-01 / EM-02: the employer's own company profile, verification documents and team. */
export const companyRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/employer/company', { config: { permission: 'employer.company.read' } }, async (req) => companyDto(await employerOrg(db, req)));

  app.put('/employer/company', { config: { permission: 'employer.company' } }, async (req) => {
    const b = parse(companyProfileSchema, req.body);
    const org = await employerOrg(db, req);
    const reg = (typeof org.registration_ids === 'string' ? JSON.parse(org.registration_ids) : org.registration_ids) as Record<string, string>;
    if (org.verification_status === 'verified' && (b.legalName !== org.legal_name || (b.gstin ?? null) !== (reg.gstin ?? null))) {
      throw invalid('The registered name and GSTIN were verified by VTA. Contact VTA to change them.', {
        ...(b.legalName !== org.legal_name ? { legalName: 'Verified by VTA' } : {}),
        ...((b.gstin ?? null) !== (reg.gstin ?? null) ? { gstin: 'Verified by VTA' } : {}),
      });
    }
    const duplicateOf = await findDuplicateOrg(db, org.id, b.legalName, b.gstin);
    const set = {
      legal_name: b.legalName,
      sector: b.sector,
      city: b.city,
      address: b.address ?? null,
      website: b.website ?? null,
      description: b.description ?? null,
      registration_ids: JSON.stringify({ ...reg, ...(b.gstin ? { gstin: b.gstin } : {}) }),
      contact_name: b.contactName,
      contact_email: b.contactEmail,
      contact_phone: b.contactPhone,
      duplicate_of: duplicateOf,
      updated_at: new Date(),
    };
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('organisations').set(set).where('id', '=', org.id).execute();
      await audit(trx, auditCtx(req), {
        action: 'organisation.profile_updated',
        entityType: 'organisation',
        entityId: org.id,
        before: { legal_name: org.legal_name, sector: org.sector, city: org.city, contact_email: org.contact_email },
        after: { legal_name: set.legal_name, sector: set.sector, city: set.city, contact_email: set.contact_email, duplicate_of: duplicateOf },
      });
    });
    return companyDto(await employerOrg(db, req));
  });

  /** Sends the company to VTA for checking (first time, or after VTA asked for more information). */
  app.post('/employer/company/submit', { config: { permission: 'employer.company' } }, async (req) => {
    const org = await employerOrg(db, req);
    if (org.verification_status === 'verified') throw invalid('Your company is already verified.');
    if (org.verification_status === 'rejected') throw invalid('VTA could not verify this company. Contact VTA to discuss it.');
    const missing: Record<string, string> = {};
    if (!org.sector) missing.sector = 'Add the sector';
    if (!org.city) missing.city = 'Add the city';
    if (!org.contact_email || !org.contact_phone) missing.contact = 'Add contact details';
    const { n } = await db.selectFrom('documents').select(sql<string>`count(*)`.as('n')).where('organisation_id', '=', org.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(n) === 0) missing.documents = 'Upload at least one registration document';
    if (Object.keys(missing).length) throw invalid('Complete the company profile before sending it to VTA.', missing);
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('organisations').set({ submitted_at: now, verification_status: 'pending', verification_reason: null, updated_at: now }).where('id', '=', org.id).execute();
      await audit(trx, auditCtx(req), { action: 'organisation.submitted', entityType: 'organisation', entityId: org.id, before: { verification_status: org.verification_status }, after: { verification_status: 'pending' } });
      await notify(trx, await vtaReviewers(trx), 'org_submitted', { org: org.legal_name, type: 'employer' }, `/admin/organisations?verificationStatus=pending`);
    });
    return companyDto(await employerOrg(db, req));
  });

  // ---- verification documents ----

  app.get('/employer/company/documents', { config: { permission: 'employer.company.read' } }, async (req) => {
    const rows = await db
      .selectFrom('documents')
      .select(['id', 'title', 'mime_type', 'size_bytes', 'verification_status', 'created_at'])
      .where('organisation_id', '=', employerOrgId(req))
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    return { items: rows.map((d) => ({ id: d.id, title: d.title, mimeType: d.mime_type, sizeBytes: d.size_bytes, verificationStatus: d.verification_status, createdAt: iso(d.created_at) })) };
  });

  app.post('/employer/company/documents', { config: { permission: 'employer.company' }, bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
    const orgId = employerOrgId(req);
    const meta = parse(z.object({ title: z.string().trim().min(2, 'Give the document a title').max(120), fileName: z.string().trim().min(1).max(200) }), req.query);
    const { n } = await db.selectFrom('documents').select(sql<string>`count(*)`.as('n')).where('organisation_id', '=', orgId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(n) >= MAX_COMPANY_DOCUMENTS) throw invalid(`Up to ${MAX_COMPANY_DOCUMENTS} company documents.`);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw invalid('Choose a file to upload', { file: 'No file received' });
    const mime = sniffMime(body);
    if (!mime) throw invalid(`Upload a ${Object.values(UPLOAD_TYPES).join(', ')} file`, { file: 'File type not allowed' });
    const id = newId();
    const storageKey = `documents/${new Date().getUTCFullYear()}/${id}`;
    await app.storage.put(storageKey, body);
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('documents')
          .values({
            id,
            owner_user_id: req.actor!.userId,
            organisation_id: orgId,
            kind: 'other' satisfies (typeof DOCUMENT_KINDS)[number],
            title: meta.title,
            storage_key: storageKey,
            original_name: safeFileName(meta.fileName),
            mime_type: mime,
            size_bytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
            uploaded_by: req.actor!.userId,
          })
          .execute();
        await audit(trx, auditCtx(req), { action: 'organisation.document_uploaded', entityType: 'organisation', entityId: orgId, after: { documentId: id, title: meta.title, mime_type: mime } });
      });
    } catch (e) {
      await app.storage.delete(storageKey);
      throw e;
    }
    reply.code(201);
    return { id };
  });

  app.get('/employer/company/documents/:id/link', { config: { permission: 'employer.company.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const d = await db.selectFrom('documents').select(['id', 'title']).where('id', '=', id).where('organisation_id', '=', employerOrgId(req)).where('deleted_at', 'is', null).executeTakeFirst();
    if (!d) throw notFound('Document');
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'organisation', entityId: employerOrgId(req), after: { documentId: d.id, title: d.title } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresInSeconds: LINK_TTL_SECONDS };
  });

  // ---- team (EM-02) ----

  const team = async (orgId: string) =>
    db
      .selectFrom('role_assignments as ra')
      .innerJoin('users as u', 'u.id', 'ra.user_id')
      .select(['ra.id as assignment_id', 'ra.role', 'u.id', 'u.name', 'u.email', 'u.status', 'u.last_login_at'])
      .where('ra.organisation_id', '=', orgId)
      .where('ra.role', 'in', ['employer_admin', 'employer_recruiter'])
      .where('ra.revoked_at', 'is', null)
      .orderBy('u.name')
      .execute();

  app.get('/employer/team', { config: { permission: 'employer.company' } }, async (req) => ({
    items: (await team(employerOrgId(req))).map((m) => ({
      assignmentId: m.assignment_id,
      userId: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status,
      lastLoginAt: iso(m.last_login_at),
      isMe: m.id === req.actor!.userId,
    })),
  }));

  /** An employer admin invites a recruiter by email (the existing invitation link sets their password). */
  app.post('/employer/team', { config: { permission: 'employer.company' } }, async (req, reply) => {
    const b = parse(inviteRecruiterSchema, req.body);
    const orgId = employerOrgId(req);
    const email = b.email.toLowerCase();
    if (await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()) throw conflict('Someone already uses this email', { email: 'Already in use' });
    const id = newId();
    let token = '';
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('users').values({ id, name: b.name, email, status: 'invited' }).execute();
      const assignment = newId();
      await trx.insertInto('role_assignments').values({ id: assignment, user_id: id, role: 'employer_recruiter', organisation_id: orgId, granted_by: req.actor!.userId }).execute();
      await audit(trx, auditCtx(req), { action: 'employer.recruiter_invited', entityType: 'organisation', entityId: orgId, after: { userId: id, name: b.name, email } });
      token = await createInvitation(trx as unknown as DB, id, req.actor!.userId);
    });
    const link = `${app.config.APP_ORIGIN}/invite/${token}`;
    await app.providers.email.sendInvitation(email, b.name, link);
    reply.code(201);
    return { id, devInviteUrl: app.providers.devEcho ? link : undefined };
  });

  /** Removes a recruiter's access to this company (their account remains; sessions see the change at once). */
  app.post('/employer/team/:id/remove', { config: { permission: 'employer.company' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const orgId = employerOrgId(req);
    const ra = await db.selectFrom('role_assignments').selectAll().where('id', '=', id).where('organisation_id', '=', orgId).where('revoked_at', 'is', null).executeTakeFirst();
    if (!ra || (ra.role !== 'employer_recruiter' && ra.role !== 'employer_admin')) throw notFound('Team member');
    if (ra.user_id === req.actor!.userId) throw forbidden('You cannot remove yourself.');
    if (ra.role === 'employer_admin') throw forbidden('Only VTA can remove an employer admin.');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('role_assignments').set({ revoked_at: new Date(), revoked_by: req.actor!.userId }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'employer.recruiter_removed', entityType: 'organisation', entityId: orgId, before: { userId: ra.user_id, role: ra.role } });
    });
    return { ok: true };
  });
};
