import type { FastifyPluginAsync } from 'fastify';
import { partnerRoutes } from './partner.js';
import { programmeRoutes } from './programmes.js';

/** Phase 7: partner organisation profile, programmes, outcome dashboards, beneficiaries and reports. */
export const programmesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(partnerRoutes);
  await app.register(programmeRoutes);
};
