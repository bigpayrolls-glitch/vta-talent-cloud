import { buildApp, LOG_SERIALIZERS } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp({
  db,
  config,
  logger:
    config.NODE_ENV === 'development'
      ? { level: 'info', transport: { target: 'pino-pretty', options: { ignore: 'pid,hostname' } }, redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'], serializers: LOG_SERIALIZERS }
      : undefined,
});

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.API_PORT, host: config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1' });
