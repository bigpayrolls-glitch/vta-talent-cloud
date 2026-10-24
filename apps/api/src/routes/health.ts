import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health/live', { config: { public: true } }, async () => ({ status: 'ok' }));

  app.get('/health/ready', { config: { public: true } }, async (_req, reply) => {
    try {
      await sql`select 1`.execute(app.db);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
};
