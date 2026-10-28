import { partnerCentreSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { forbidden } from '../../lib/errors.js';
import { notify, vtaReviewers } from '../../lib/notify.js';
import { parse } from '../../lib/validate.js';
import { partnerOrgs } from '../../policy/index.js';
import { locationOf } from '../admin/centres.js';

/**
 * 28 Oct 2026: a training partner adds a centre for its own organisation, straight from the "Location (centre)"
 * list. It is usable at once; Admins are told and can edit, deactivate or delete it.
 */
export const partnerCentreRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.post('/partner/centres', { config: { permission: 'centre.add_own' } }, async (req, reply) => {
    const b = parse(partnerCentreSchema, req.body);
    const orgId = partnerOrgs(req.actor!)[0];
    if (!orgId) throw forbidden('Only a training partner can add its own centre.');
    const row = {
      id: newId(),
      name: b.name,
      organisation_id: orgId,
      address: b.address ?? null,
      city: b.city,
      contact_phone: b.contactPhone ?? null,
      status: 'active' as const,
      ...locationOf(b),
      created_by: req.actor!.userId,
    };
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('centres').values(row).execute();
      await audit(trx, auditCtx(req), { action: 'centre.created_by_partner', entityType: 'centre', entityId: row.id, after: row });
      const org = await trx.selectFrom('organisations').select('legal_name').where('id', '=', orgId).executeTakeFirstOrThrow();
      await notify(trx, await vtaReviewers(trx), 'centre_added', { name: row.name, org: org.legal_name, city: row.city }, '/admin/centres');
    });
    reply.code(201);
    return { id: row.id };
  });
};
