import type { FastifyPluginAsync } from 'fastify';
import { batchRoutes } from './batches.js';
import { candidateRoutes } from './candidates.js';
import { courseRoutes } from './courses.js';
import { fileRoutes } from './files.js';
import { partnerCentreRoutes } from './partnerCentres.js';
import { partnerCourseRoutes } from './partnerCourses.js';
import { partnerSubscriptionRoutes } from './partnerSubscription.js';
import { trainerRoutes } from './trainers.js';

/** Phase 2: training master data. Management routes live under /admin/*, scoped reads at the top level. */
export const trainingRoutes: FastifyPluginAsync = async (app) => {
  await app.register(courseRoutes);
  await app.register(trainerRoutes);
  await app.register(candidateRoutes);
  await app.register(batchRoutes);
  await app.register(fileRoutes);
  await app.register(partnerCourseRoutes);
  await app.register(partnerSubscriptionRoutes);
  await app.register(partnerCentreRoutes);
};
