import { listQuerySchema, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { iso, parse } from '../../lib/validate.js';

const filterSchema = listQuerySchema.extend({
  actorId: uuidSchema.optional(),
  entityType: z.enum(['user', 'organisation', 'centre']).optional(),
  entityId: uuidSchema.optional(),
  action: z.string().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export interface AuditEventDto {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

/** F-07: read-only audit log viewer, filterable by actor, entity and date. No write routes exist. */
export const auditRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/audit-events', { config: { permission: 'audit.read' } }, async (req): Promise<Page<AuditEventDto>> => {
    const f = parse(filterSchema, req.query);
    let q = db
      .selectFrom('audit_events as a')
      .leftJoin('users as actor', 'actor.id', 'a.actor_id')
      .leftJoin('users as tu', (j) => j.onRef('tu.id', '=', 'a.entity_id').on('a.entity_type', '=', 'user'))
      .leftJoin('organisations as tor', (j) => j.onRef('tor.id', '=', 'a.entity_id').on('a.entity_type', '=', 'organisation'))
      .leftJoin('centres as tc', (j) => j.onRef('tc.id', '=', 'a.entity_id').on('a.entity_type', '=', 'centre'));
    if (f.actorId) q = q.where('a.actor_id', '=', f.actorId);
    if (f.entityType) q = q.where('a.entity_type', '=', f.entityType);
    if (f.entityId) q = q.where('a.entity_id', '=', f.entityId);
    if (f.action) q = q.where('a.action', 'like', `${f.action.replace(/[%_\\]/g, '\\$&')}%`);
    if (f.from) q = q.where('a.created_at', '>=', new Date(`${f.from}T00:00:00+05:30`));
    if (f.to) q = q.where('a.created_at', '<', new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000));
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['a.id', 'a.created_at', 'a.actor_id', 'actor.name as actor_name', 'a.action', 'a.entity_type', 'a.entity_id', 'a.request_id', 'a.before', 'a.after', 'tu.name as tu_name', 'tor.legal_name as tor_name', 'tc.name as tc_name'])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: iso(r.created_at)!,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityLabel: r.tu_name ?? r.tor_name ?? r.tc_name ?? null,
        requestId: r.request_id,
        before: r.before,
        after: r.after,
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });
};
