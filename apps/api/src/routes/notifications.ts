import { renderNotification, uuidSchema, type NotificationDto } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Selectable } from 'kysely';
import type { NotificationsTable } from '../db/types.js';
import { notFound } from '../lib/errors.js';
import { iso, parse } from '../lib/validate.js';

/** SH-07: each person sees only their own notifications. */
function dto(n: Selectable<NotificationsTable>): NotificationDto {
  const params = (typeof n.params === 'string' ? JSON.parse(n.params) : n.params) as Record<string, string>;
  return { id: n.id, template: n.template, ...renderNotification(n.template, params), link: n.link, readAt: iso(n.read_at), createdAt: iso(n.created_at)! };
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(['1']).optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const unreadCount = async (userId: string) =>
    Number((await db.selectFrom('notifications').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', userId).where('read_at', 'is', null).executeTakeFirstOrThrow()).n);

  app.get('/notifications', { config: { permission: 'self.read' } }, async (req) => {
    const f = parse(listSchema, req.query);
    const userId = req.actor!.userId;
    let q = db.selectFrom('notifications').where('user_id', '=', userId);
    if (f.unread) q = q.where('read_at', 'is', null);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute();
    return { items: rows.map(dto), page: f.page, pageSize: f.pageSize, total: Number(total), unread: await unreadCount(userId) };
  });

  /** Polled by the header bell; kept tiny. */
  app.get('/notifications/unread-count', { config: { permission: 'self.read' } }, async (req) => ({ unread: await unreadCount(req.actor!.userId) }));

  app.post('/notifications/:id/read', { config: { permission: 'self.read' } }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const n = await db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', req.actor!.userId)
      .where('read_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!n && !(await db.selectFrom('notifications').select('id').where('id', '=', id).where('user_id', '=', req.actor!.userId).executeTakeFirst())) throw notFound('Notification');
    return { unread: await unreadCount(req.actor!.userId) };
  });

  app.post('/notifications/read-all', { config: { permission: 'self.read' } }, async (req) => {
    await db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', req.actor!.userId).where('read_at', 'is', null).execute();
    return { unread: 0 };
  });
};
