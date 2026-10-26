import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Permission } from '@vta/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import { resolveActor, SESSION_COOKIE } from './auth/sessions.js';
import { ApiError } from './lib/errors.js';
import { newId, safeEqual } from './lib/crypto.js';
import { consoleProviders, type Providers } from './lib/providers.js';
import { assertPermission, type Actor } from './policy/index.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { sharedRoutes } from './routes/shared.js';
import { healthRoutes } from './routes/health.js';
import { trainingRoutes } from './routes/training/index.js';
import { operationsRoutes } from './routes/operations/index.js';
import { learnerRoutes } from './routes/learner/routes.js';
import { hiringRoutes } from './routes/hiring/index.js';
import { programmesRoutes } from './routes/programmes/index.js';
import { localStorage, type Storage } from './lib/storage.js';
import { UPLOAD_MAX_BYTES } from '@vta/shared';
import type { AuditContext } from './audit/service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Permission required for this route. Every route must set this or `public: true`. */
    permission?: Permission;
    public?: boolean;
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    db: DB;
    config: Config;
    providers: Providers;
    storage: Storage;
    routeTable: RouteInfo[];
  }
}

export interface RouteInfo {
  method: string;
  url: string;
  permission: Permission | null;
  public: boolean;
}

export interface AppOptions {
  db: DB;
  config: Config;
  providers?: Providers;
  storage?: Storage;
  logger?: FastifyServerOptions['logger'];
}

/** Paths and body fields that must never reach the logs (SEC-15). */
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

/** Strips signed-link signatures from logged URLs. */
const redactUrl = (url: string) => url.replace(/([?&]sig=)[^&]+/, '$1[redacted]');
export const LOG_SERIALIZERS = {
  req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: redactUrl(req.url), id: req.id }),
};

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: 'info', redact: { paths: REDACT_PATHS, censor: '[redacted]' }, serializers: LOG_SERIALIZERS },
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      return typeof given === 'string' && /^[\w-]{8,64}$/.test(given) ? given : newId();
    },
    trustProxy: opts.config.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  app.decorate('db', opts.db);
  app.decorate('config', opts.config);
  app.decorate('providers', opts.providers ?? consoleProviders(app.log));
  app.decorate('storage', opts.storage ?? localStorage(opts.config.STORAGE_DIR));
  app.decorateRequest('actor', null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: opts.config.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  // Browser tests sign in many times a minute from one machine. VTA_RELAX_RATE_LIMITS lifts the per-IP limits
  // for this machine only, and is ignored in production. Per-number OTP limits and account lockout still apply.
  const relaxLocal = process.env.VTA_RELAX_RATE_LIMITS === '1' && opts.config.NODE_ENV !== 'production';
  await app.register(rateLimit, {
    global: false,
    ...(relaxLocal ? { allowList: (req: { ip: string }) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) } : {}),
  });

  // File uploads arrive as the raw file body (no multipart parsing), capped at the upload limit.
  app.addContentTypeParser(
    ['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png'],
    { parseAs: 'buffer', bodyLimit: UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  // Every route must declare a permission or be explicitly public (F-05).
  const routeTable: RouteInfo[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    const cfg = route.config as { permission?: Permission; public?: boolean } | undefined;
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return;
    if (!cfg?.permission && !cfg?.public) {
      throw new Error(`Route ${String(route.method)} ${route.url} must declare config.permission or config.public`);
    }
    routeTable.push({ method: String(route.method), url: route.url, permission: cfg.permission ?? null, public: !!cfg.public });
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
    const cfg: { permission?: Permission; public?: boolean } = req.routeOptions.config ?? {};
    req.actor = await resolveActor(app.db, req.cookies[SESSION_COOKIE]);
    if (cfg.public) return;
    if (!cfg.permission) throw new ApiError('NOT_FOUND', 'Route not found');
    if (!req.actor) throw new ApiError('UNAUTHENTICATED', 'Please sign in');
    // CSRF: state-changing requests must echo the session's CSRF token in a header.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, req.actor.csrfToken)) {
        throw new ApiError('FORBIDDEN', 'Missing or invalid CSRF token. Reload the page and try again.');
      }
    }
    assertPermission(req.actor, cfg.permission);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, fields: err.fields, requestId: req.id },
      });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.', requestId: req.id } });
    }
    if (e.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'VALIDATION_FAILED', message: 'The file is too large. The limit is 10 MB.', fields: { file: 'Larger than 10 MB' }, requestId: req.id } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: e.message ?? 'Bad request', requestId: req.id } });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: req.id } });
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(sharedRoutes);
      await api.register(trainingRoutes);
      await api.register(operationsRoutes);
      await api.register(learnerRoutes);
      await api.register(hiringRoutes);
      await api.register(programmesRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

/** Audit context for the current request. */
export const auditCtx = (req: { actor: Actor | null; id: string; ip: string }): AuditContext => ({
  actorId: req.actor?.userId ?? null,
  requestId: req.id,
  ip: req.ip,
});
