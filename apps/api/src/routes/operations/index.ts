import type { FastifyPluginAsync } from 'fastify';
import { assessmentRoutes } from './assessments.js';
import { attendanceRoutes } from './attendance.js';
import { credentialRoutes } from './credentials.js';
import { offlineRoutes } from './offline.js';

/** Phase 3: training operations — attendance, assessments, review and credentials. */
export const operationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(attendanceRoutes);
  await app.register(assessmentRoutes);
  await app.register(credentialRoutes);
  // Phase 4: offline attendance for trainers.
  await app.register(offlineRoutes);
};
