import type { FastifyPluginAsync } from 'fastify';
import { hiringAdminRoutes } from './admin.js';
import { companyRoutes } from './company.js';
import { employerJobRoutes } from './employerJobs.js';
import { learnerJobRoutes } from './learnerJobs.js';
import { searchRoutes } from './search.js';

/** Phase 6: employers, jobs, applications and hiring outcomes. */
export const hiringRoutes: FastifyPluginAsync = async (app) => {
  await app.register(companyRoutes);
  await app.register(employerJobRoutes);
  await app.register(searchRoutes);
  await app.register(learnerJobRoutes);
  await app.register(hiringAdminRoutes);
};
