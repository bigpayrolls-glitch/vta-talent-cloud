import { createOrganisationSchema, listQuerySchema, reasonSchema, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Organisation } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';

export function organisationDto(o: Organisation) {
  return {
    id: o.id,
    type: o.type,
    partnerSubtype: o.partner_subtype,
    legalName: o.legal_name,
    registrationIds: o.registration_ids,
    address: o.address,
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    contactPhone: o.contact_phone,
    verificationStatus: o.verification_status,
    verificationReason: o.verification_reason,
    verifiedAt: iso(o.verified_at),
    status: o.status,
    createdAt: iso(o.created_at),
  };
}

const filterSchema = listQuerySchema.extend({
  type: z.enum(['employer', 'partner']).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'more_info_needed']).optional(),
});

const idParam = z.object({ id: uuidSchema });

export const organisationRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/organisations', { config: { permission: 'organisation.manage' } }, async (req): Promise<Page<ReturnType<typeof organisationDto>>> => {
    const f = parse(filterSchema, req.query);
    let q = db.selectFrom('organisations').where('type', '!=', 'vta');
    if (f.type) q = q.where('type', '=', f.type);
    if (f.verificationStatus) q = q.where('verification_status', '=', f.verificationStatus);
    if (f.q) q = q.where('legal_name', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('created_at', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute();
    return { items: rows.map(organisationDto), page: f.page, pageSize: f.pageSize, total: Number(total) };
  });

  app.post('/organisations', { config: { permission: 'organisation.manage' } }, async (req, reply) => {
    const b = parse(createOrganisationSchema, req.body);
    const row = {
      id: newId(),
      type: b.type,
      partner_subtype: b.type === 'partner' ? (b.partnerSubtype ?? null) : null,
      legal_name: b.legalName,
      registration_ids: JSON.stringify(b.registrationIds),
      address: b.address ?? null,
      contact_name: b.contactName ?? null,
      contact_email: b.contactEmail ?? null,
      contact_phone: b.contactPhone ?? null,
      verification_status: 'pending' as const,
      status: 'active' as const,
    };
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('organisations').values(row).execute();
      await audit(trx, auditCtx(req), { action: 'organisation.created', entityType: 'organisation', entityId: row.id, after: { ...row, registration_ids: b.registrationIds } });
    });
    reply.code(201);
    return { id: row.id };
  });

  /** F-10 / AD-08: verify, reject or ask for more information, with a reason where needed. */
  const decisions = [
    { path: 'verify', to: 'verified', needsReason: false },
    { path: 'reject', to: 'rejected', needsReason: true },
    { path: 'request-info', to: 'more_info_needed', needsReason: true },
  ] as const;

  for (const d of decisions) {
    app.post(`/organisations/:id/${d.path}`, { config: { permission: 'organisation.verify' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = d.needsReason ? parse(reasonSchema, req.body).reason : null;
      const org = await db.selectFrom('organisations').selectAll().where('id', '=', id).where('type', '!=', 'vta').executeTakeFirst();
      if (!org) throw notFound('Organisation');
      if (org.verification_status === d.to) throw invalid(`This organisation is already ${d.to.replace(/_/g, ' ')}.`);
      const now = new Date();
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('organisations')
          .set({
            verification_status: d.to,
            verification_reason: reason,
            verified_by: d.to === 'verified' ? req.actor!.userId : null,
            verified_at: d.to === 'verified' ? now : null,
            updated_at: now,
          })
          .where('id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), {
          action: `organisation.${d.to}`,
          entityType: 'organisation',
          entityId: id,
          before: { verification_status: org.verification_status },
          after: { verification_status: d.to, reason },
        });
      });
      return { id, verificationStatus: d.to };
    });
  }
};
