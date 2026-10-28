import { centreMapLink, listQuerySchema, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Centre } from '../db/types.js';
import { notFound } from '../lib/errors.js';
import { iso, parse } from '../lib/validate.js';
import { centreScope, inScope, memberListScope, organisationScope } from '../policy/index.js';
import { organisationDto } from './admin/organisations.js';

const idParam = z.object({ id: uuidSchema });

function centreDto(c: Centre & { organisation_name?: string | null }) {
  return {
    id: c.id,
    name: c.name,
    organisationId: c.organisation_id,
    organisationName: c.organisation_name ?? null,
    address: c.address,
    city: c.city,
    contactPhone: c.contact_phone,
    status: c.status,
    latitude: c.latitude,
    longitude: c.longitude,
    mapUrl: c.map_url,
    mapLink: centreMapLink({ latitude: c.latitude, longitude: c.longitude, mapUrl: c.map_url }),
    createdAt: iso(c.created_at),
  };
}

/**
 * Scoped reads used by every portal. The same URL returns different rows for different users:
 * the policy module supplies the scope, and anything outside it is "not found" (SEC-02).
 */
export const sharedRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/organisations', { config: { permission: 'organisation.read' } }, async (req) => {
    const f = parse(listQuerySchema, req.query);
    const scope = organisationScope(req.actor!);
    if (scope !== 'all' && scope.length === 0) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
    let q = db.selectFrom('organisations').where('type', '!=', 'vta');
    if (scope !== 'all') q = q.where('id', 'in', scope);
    if (f.q) q = q.where('legal_name', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('legal_name').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute();
    return { items: rows.map(organisationDto), page: f.page, pageSize: f.pageSize, total: Number(total) };
  });

  app.get('/organisations/:id', { config: { permission: 'organisation.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!inScope(organisationScope(req.actor!), id)) throw notFound('Organisation');
    const org = await db.selectFrom('organisations').selectAll().where('id', '=', id).where('type', '!=', 'vta').executeTakeFirst();
    if (!org) throw notFound('Organisation');
    return organisationDto(org);
  });

  app.get('/organisations/:id/members', { config: { permission: 'organisation.members.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!inScope(memberListScope(req.actor!), id)) throw notFound('Organisation');
    const rows = await db
      .selectFrom('role_assignments as ra')
      .innerJoin('users as u', 'u.id', 'ra.user_id')
      .select(['u.id', 'u.name', 'u.email', 'u.status', 'ra.role', 'ra.centre_id'])
      .where('ra.organisation_id', '=', id)
      .where('ra.revoked_at', 'is', null)
      .orderBy('u.name')
      .execute();
    return { items: rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, status: r.status, role: r.role, centreId: r.centre_id })) };
  });

  const centreFilter = listQuerySchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
    organisationId: uuidSchema.optional(),
  });

  app.get('/centres', { config: { permission: 'centre.read' } }, async (req): Promise<Page<ReturnType<typeof centreDto>>> => {
    const f = parse(centreFilter, req.query);
    const scope = await centreScope(db, req.actor!);
    if (scope !== 'all' && scope.length === 0) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
    let q = db.selectFrom('centres as c').leftJoin('organisations as o', 'o.id', 'c.organisation_id');
    if (scope !== 'all') q = q.where('c.id', 'in', scope);
    if (f.status) q = q.where('c.status', '=', f.status);
    if (f.organisationId) q = q.where('c.organisation_id', '=', f.organisationId);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('c.name', 'ilike', like), eb('c.city', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .selectAll('c')
      .select('o.legal_name as organisation_name')
      .orderBy('c.name')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return { items: rows.map(centreDto), page: f.page, pageSize: f.pageSize, total: Number(total) };
  });

  app.get('/centres/:id', { config: { permission: 'centre.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!inScope(await centreScope(db, req.actor!), id)) throw notFound('Centre');
    const c = await db
      .selectFrom('centres as c')
      .leftJoin('organisations as o', 'o.id', 'c.organisation_id')
      .selectAll('c')
      .select('o.legal_name as organisation_name')
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c) throw notFound('Centre');
    return centreDto(c);
  });
};
