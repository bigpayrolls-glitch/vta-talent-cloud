import type { FastifyPluginAsync } from 'fastify';
import { auditRoutes } from './admin/audit.js';
import { centreRoutes } from './admin/centres.js';
import { dashboardRoutes } from './admin/dashboard.js';
import { organisationRoutes } from './admin/organisations.js';
import { roleRoutes } from './admin/roles.js';
import { userRoutes } from './admin/users.js';

/** /api/v1/admin/* — Admin Portal. Each route still declares its own permission. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(dashboardRoutes);
  await app.register(userRoutes);
  await app.register(roleRoutes);
  await app.register(organisationRoutes);
  await app.register(centreRoutes);
  await app.register(auditRoutes);
};
