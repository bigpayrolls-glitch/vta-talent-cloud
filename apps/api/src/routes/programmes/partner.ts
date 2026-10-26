import { inviteRecruiterSchema, partnerProfileSchema, reportFilterSchema, UPLOAD_MAX_BYTES, UPLOAD_TYPES, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { notify, vtaReviewers } from '../../lib/notify.js';
import type { Organisation } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { toCsv } from '../../lib/csv.js';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import type { DB } from '../../db/index.js';
import { createInvitation } from '../admin/users.js';
import { LINK_TTL_SECONDS, safeFileName, signLink, sniffMime } from '../../lib/storage.js';
import { iso, parse } from '../../lib/validate.js';
import { cohortMetrics, metricRate } from './metrics.js';

const reg = (o: Organisation) => (typeof o.registration_ids === 'string' ? JSON.parse(o.registration_ids) : o.registration_ids) as Record<string, string>;

function partnerDto(o: Organisation) {
  return {
    id: o.id,
    legalName: o.legal_name,
    partnerSubtype: o.partner_subtype,
    city: o.city,
    address: o.address,
    website: o.website,
    registrationNumber: reg(o).registrationNumber ?? null,
    programmeInterests: o.programme_interests,
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    contactPhone: o.contact_phone,
    verificationStatus: o.verification_status,
    verificationReason: ['more_info_needed', 'rejected'].includes(o.verification_status) ? o.verification_reason : null,
    submittedAt: iso(o.submitted_at),
    identityLocked: o.verification_status === 'verified',
  };
}

/** PA-01: the partner's own organisation profile and verification documents. AD-11: VTA cohort reports. */
export const partnerRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const orgId = (req: FastifyRequest) => {
    const a = req.actor!.assignments.find((x) => (x.role === 'partner_admin' || x.role === 'partner_viewer') && x.organisationId);
    if (!a) throw forbidden('This account is not linked to a training partner.');
    return a.organisationId!;
  };
  const org = async (req: FastifyRequest) => {
    const o = await db.selectFrom('organisations').selectAll().where('id', '=', orgId(req)).executeTakeFirst();
    if (!o) throw notFound('Organisation');
    return o;
  };

  app.get('/partner/organisation', { config: { permission: 'partner.profile.read' } }, async (req) => partnerDto(await org(req)));

  app.put('/partner/organisation', { config: { permission: 'partner.profile' } }, async (req) => {
    const b = parse(partnerProfileSchema, req.body);
    const o = await org(req);
    if (o.verification_status === 'verified' && (b.legalName !== o.legal_name || (b.registrationNumber ?? null) !== (reg(o).registrationNumber ?? null))) {
      throw invalid('The registered name and number were verified by AutoTalent Grid. Contact AutoTalent Grid to change them.', { legalName: 'Verified by AutoTalent Grid' });
    }
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('organisations')
        .set({
          legal_name: b.legalName,
          partner_subtype: b.partnerSubtype,
          city: b.city,
          address: b.address ?? null,
          website: b.website ?? null,
          programme_interests: b.programmeInterests ?? null,
          registration_ids: JSON.stringify({ ...reg(o), ...(b.registrationNumber ? { registrationNumber: b.registrationNumber } : {}) }),
          contact_name: b.contactName,
          contact_email: b.contactEmail,
          contact_phone: b.contactPhone,
          updated_at: new Date(),
        })
        .where('id', '=', o.id)
        .execute();
      await audit(trx, auditCtx(req), { action: 'organisation.profile_updated', entityType: 'organisation', entityId: o.id, before: { legal_name: o.legal_name, city: o.city }, after: { legal_name: b.legalName, city: b.city } });
    });
    return partnerDto(await org(req));
  });

  app.post('/partner/organisation/submit', { config: { permission: 'partner.profile' } }, async (req) => {
    const o = await org(req);
    if (o.verification_status === 'verified') throw invalid('Your organisation is already verified.');
    if (o.verification_status === 'rejected') throw invalid('AutoTalent Grid could not verify this organisation. Contact AutoTalent Grid to discuss it.');
    const { n } = await db.selectFrom('documents').select(sql<string>`count(*)`.as('n')).where('organisation_id', '=', o.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    const missing: Record<string, string> = {};
    if (!o.city) missing.city = 'Add the city';
    if (!o.contact_email || !o.contact_phone) missing.contact = 'Add contact details';
    if (Number(n) === 0) missing.documents = 'Upload at least one registration document';
    if (Object.keys(missing).length) throw invalid('Complete the organisation profile before sending it to AutoTalent Grid.', missing);
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('organisations').set({ submitted_at: now, verification_status: 'pending', verification_reason: null, updated_at: now }).where('id', '=', o.id).execute();
      await audit(trx, auditCtx(req), { action: 'organisation.submitted', entityType: 'organisation', entityId: o.id, before: { verification_status: o.verification_status }, after: { verification_status: 'pending' } });
      await notify(trx, await vtaReviewers(trx), 'org_submitted', { org: o.legal_name, type: 'partner' }, `/admin/organisations?verificationStatus=pending`);
    });
    return partnerDto(await org(req));
  });

  app.get('/partner/organisation/documents', { config: { permission: 'partner.profile.read' } }, async (req) => {
    const rows = await db.selectFrom('documents').select(['id', 'title', 'size_bytes', 'created_at']).where('organisation_id', '=', orgId(req)).where('deleted_at', 'is', null).orderBy('created_at', 'desc').execute();
    return { items: rows.map((d) => ({ id: d.id, title: d.title, sizeBytes: d.size_bytes, createdAt: iso(d.created_at) })) };
  });

  app.post('/partner/organisation/documents', { config: { permission: 'partner.profile' }, bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
    const id0 = orgId(req);
    const meta = parse(z.object({ title: z.string().trim().min(2, 'Give the document a title').max(120), fileName: z.string().trim().min(1).max(200) }), req.query);
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
          .values({ id, owner_user_id: req.actor!.userId, organisation_id: id0, kind: 'other', title: meta.title, storage_key: storageKey, original_name: safeFileName(meta.fileName), mime_type: mime, size_bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), uploaded_by: req.actor!.userId })
          .execute();
        await audit(trx, auditCtx(req), { action: 'organisation.document_uploaded', entityType: 'organisation', entityId: id0, after: { documentId: id, title: meta.title } });
      });
    } catch (e) {
      await app.storage.delete(storageKey);
      throw e;
    }
    reply.code(201);
    return { id };
  });

  app.get('/partner/organisation/documents/:id/link', { config: { permission: 'partner.profile.read' } }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const d = await db.selectFrom('documents').select(['id', 'title']).where('id', '=', id).where('organisation_id', '=', orgId(req)).where('deleted_at', 'is', null).executeTakeFirst();
    if (!d) throw notFound('Document');
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'organisation', entityId: orgId(req), after: { documentId: d.id } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresInSeconds: LINK_TTL_SECONDS };
  });

  // ---------------------------------------------------------------- AD-11 cohort report (VTA staff)

  /** Batches in the cohort: start date in range, and matching course, centre, partner (centre owner) and programme. */
  const cohortBatches = async (f: z.output<typeof reportFilterSchema>) => {
    let q = db.selectFrom('batches as b').innerJoin('centres as c', 'c.id', 'b.centre_id').select('b.id').where('b.status', '!=', 'cancelled');
    if (f.from) q = q.where('b.start_date', '>=', f.from);
    if (f.to) q = q.where('b.start_date', '<=', f.to);
    if (f.courseId) q = q.where('b.course_id', '=', f.courseId);
    if (f.centreId) q = q.where('b.centre_id', '=', f.centreId);
    if (f.partnerId) q = q.where('c.organisation_id', '=', f.partnerId);
    if (f.programmeId) q = q.where('b.id', 'in', db.selectFrom('programme_batches').select('batch_id').where('programme_id', '=', f.programmeId));
    return (await q.execute()).map((b) => b.id);
  };
  const describe = async (f: z.output<typeof reportFilterSchema>) => {
    const name = async (table: 'courses' | 'centres' | 'organisations' | 'programmes', id?: string) => {
      if (!id) return null;
      const col = table === 'courses' ? 'title' : table === 'organisations' ? 'legal_name' : 'name';
      const r = await db.selectFrom(table).select(sql<string>`${sql.ref(col)}`.as('n')).where('id', '=', id).executeTakeFirst();
      return r?.n ?? 'Unknown';
    };
    return {
      from: f.from ?? null,
      to: f.to ?? null,
      course: await name('courses', f.courseId),
      centre: await name('centres', f.centreId),
      partner: await name('organisations', f.partnerId),
      programme: await name('programmes', f.programmeId),
    };
  };

  app.get('/admin/reports/cohort', { config: { permission: 'report.read' } }, async (req) => {
    const f = parse(reportFilterSchema, req.query);
    const batchIds = await cohortBatches(f);
    const { metrics, asOf } = await cohortMetrics(db, batchIds);
    return { asOf, filters: await describe(f), cohort: `Enrolments in ${batchIds.length} ${batchIds.length === 1 ? 'batch' : 'batches'} (not cancelled) starting in the chosen dates and matching the filters.`, batches: batchIds.length, metrics };
  });

  app.get('/admin/reports/cohort.csv', { config: { permission: 'report.read' } }, async (req, reply) => {
    const f = parse(reportFilterSchema, req.query);
    const batchIds = await cohortBatches(f);
    const { metrics, asOf } = await cohortMetrics(db, batchIds);
    const d = await describe(f);
    await audit(db, auditCtx(req), { action: 'report.exported', entityType: 'report', entityId: null, after: { report: 'cohort', filters: f, personalData: false } });
    const csv = toCsv([
      ['AutoTalent Grid cohort report'],
      ['As of', asOf],
      ['Batch start from', d.from ?? 'any'],
      ['Batch start to', d.to ?? 'any'],
      ['Course', d.course ?? 'all'],
      ['Centre', d.centre ?? 'all'],
      ['Partner', d.partner ?? 'all'],
      ['Programme', d.programme ?? 'all'],
      ['Batches in cohort', batchIds.length],
      ['Note', 'Aggregate figures only. No personal data.'],
      [],
      ['Measure', 'Value', 'Out of', 'Rate %', 'Type', 'Definition'],
      ...metrics.map((m) => [m.label, m.value, m.denominator ? `${m.denominator.value} (${m.denominator.label})` : '', metricRate(m) ?? '', m.basis.replace('_', ' '), m.definition]),
    ]);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="cohort-report.csv"').header('cache-control', 'private, no-store').send(csv);
  });

  // ---- PA-07: the partner admin invites and removes viewers (read-only users for the same organisation) ----

  const teamOf = (organisationId: string) =>
    db
      .selectFrom('role_assignments as ra')
      .innerJoin('users as u', 'u.id', 'ra.user_id')
      .select(['ra.id as assignment_id', 'ra.role', 'u.id', 'u.name', 'u.email', 'u.status', 'u.last_login_at'])
      .where('ra.organisation_id', '=', organisationId)
      .where('ra.role', 'in', ['partner_admin', 'partner_viewer'])
      .where('ra.revoked_at', 'is', null)
      .orderBy('u.name')
      .execute();

  app.get('/partner/team', { config: { permission: 'partner.profile' } }, async (req) => ({
    items: (await teamOf(orgId(req))).map((m) => ({
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

  /** Viewers see the organisation's programmes, reports and documents but cannot change anything. */
  app.post('/partner/team', { config: { permission: 'partner.profile' } }, async (req, reply) => {
    const b = parse(inviteRecruiterSchema, req.body);
    const organisationId = orgId(req);
    const email = b.email.toLowerCase();
    if (await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()) throw conflict('Someone already uses this email', { email: 'Already in use' });
    const id = newId();
    let token = '';
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('users').values({ id, name: b.name, email, status: 'invited' }).execute();
      await trx.insertInto('role_assignments').values({ id: newId(), user_id: id, role: 'partner_viewer', organisation_id: organisationId, granted_by: req.actor!.userId }).execute();
      await audit(trx, auditCtx(req), { action: 'partner.viewer_invited', entityType: 'organisation', entityId: organisationId, after: { userId: id, name: b.name, email, role: 'partner_viewer' } });
      token = await createInvitation(trx as unknown as DB, id, req.actor!.userId);
    });
    const link = `${app.config.APP_ORIGIN}/invite/${token}`;
    await app.providers.email.sendInvitation(email, b.name, link);
    reply.code(201);
    return { id, devInviteUrl: app.providers.devEcho ? link : undefined };
  });

  app.post('/partner/team/:id/remove', { config: { permission: 'partner.profile' } }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const organisationId = orgId(req);
    const ra = await db.selectFrom('role_assignments').selectAll().where('id', '=', id).where('organisation_id', '=', organisationId).where('revoked_at', 'is', null).executeTakeFirst();
    if (!ra || (ra.role !== 'partner_viewer' && ra.role !== 'partner_admin')) throw notFound('Team member');
    if (ra.user_id === req.actor!.userId) throw forbidden('You cannot remove yourself.');
    if (ra.role === 'partner_admin') throw forbidden('Only AutoTalent Grid can remove a partner admin.');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('role_assignments').set({ revoked_at: new Date(), revoked_by: req.actor!.userId }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'partner.viewer_removed', entityType: 'organisation', entityId: organisationId, before: { userId: ra.user_id, role: ra.role } });
    });
    return { ok: true };
  });
};
