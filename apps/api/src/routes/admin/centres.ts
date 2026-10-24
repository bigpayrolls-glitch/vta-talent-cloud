import { centreSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import { newId } from '../../lib/crypto.js';
import { invalid, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';

const idParam = z.object({ id: uuidSchema });

async function assertOwnerIsPartner(db: DB, organisationId: string | undefined) {
  if (!organisationId) return;
  const org = await db.selectFrom('organisations').select(['type']).where('id', '=', organisationId).executeTakeFirst();
  if (!org || org.type !== 'partner') throw invalid('A centre can only belong to VTA or a training partner', { organisationId: 'Choose a training partner' });
}

/** F-11 / AD-03: centres are created and edited by VTA admins. Reading is in shared.ts (scoped). */
export const centreRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.post('/centres', { config: { permission: 'centre.manage' } }, async (req, reply) => {
    const b = parse(centreSchema, req.body);
    await assertOwnerIsPartner(db, b.organisationId);
    const row = {
      id: newId(),
      name: b.name,
      organisation_id: b.organisationId ?? null,
      address: b.address ?? null,
      city: b.city ?? null,
      contact_phone: b.contactPhone ?? null,
      status: 'active' as const,
    };
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('centres').values(row).execute();
      await audit(trx, auditCtx(req), { action: 'centre.created', entityType: 'centre', entityId: row.id, after: row });
    });
    reply.code(201);
    return { id: row.id };
  });

  app.patch('/centres/:id', { config: { permission: 'centre.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(centreSchema.partial(), req.body);
    const before = await db.selectFrom('centres').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('Centre');
    await assertOwnerIsPartner(db, b.organisationId);
    const changes = {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.organisationId !== undefined && { organisation_id: b.organisationId }),
      ...(b.address !== undefined && { address: b.address }),
      ...(b.city !== undefined && { city: b.city }),
      ...(b.contactPhone !== undefined && { contact_phone: b.contactPhone }),
    };
    if (!Object.keys(changes).length) throw invalid('Nothing to change');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('centres').set({ ...changes, updated_at: new Date() }).where('id', '=', id).execute();
      const prior = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]));
      await audit(trx, auditCtx(req), { action: 'centre.updated', entityType: 'centre', entityId: id, before: prior, after: changes });
    });
    return { id };
  });

  for (const [path, status] of [['deactivate', 'inactive'], ['activate', 'active']] as const) {
    app.post(`/centres/:id/${path}`, { config: { permission: 'centre.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const c = await db.selectFrom('centres').select(['status']).where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound('Centre');
      if (c.status === status) throw invalid(`This centre is already ${status}.`);
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('centres').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
        await audit(trx, auditCtx(req), { action: `centre.${path}d`, entityType: 'centre', entityId: id, before: { status: c.status }, after: { status } });
      });
      return { id, status };
    });
  }
};
