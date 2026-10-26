/**
 * Vercel Function entry: the same Fastify app as server.ts, created once per instance and handed each request.
 * Routes reach it through the rewrite in scripts/vercel-build.mjs; the original path arrives in ?__path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';

// A hosted function always runs as production (secure cookies, trusted proxy for client IPs).
process.env.NODE_ENV = 'production';
const config = loadConfig();
// Few connections per instance: serverless instances are many and short-lived (use the pooled URL).
const db = createDb(config.databaseUrl, 3);
const ready = buildApp({ db, config }).then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  const url = new URL(req.url ?? '/', 'http://local');
  const original = url.searchParams.get('__path');
  if (original) {
    url.searchParams.delete('__path');
    const rest = url.searchParams.toString();
    req.url = `${original}${rest ? `?${rest}` : ''}`;
  }
  app.server.emit('request', req, res);
}
