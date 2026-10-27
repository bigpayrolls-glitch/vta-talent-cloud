import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings, not JS Dates shifted by time zone.
pg.types.setTypeParser(1082, (v) => v);

export type DB = Kysely<Database>;

/**
 * Supabase's poolers (pooler.supabase.com) and direct hosts (supabase.co) are reached over TLS. Their certificate
 * comes from Supabase's own root CA, which Node does not trust by default: give it in DATABASE_CA (PEM) to verify
 * it fully; otherwise the connection is still encrypted but the certificate is not checked.
 * Other hosts keep whatever the connection string says (Neon sets sslmode itself; local Postgres has no TLS).
 */
export function sslFor(connectionString: string, ca = process.env.DATABASE_CA): pg.PoolConfig['ssl'] {
  let host = '';
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return undefined;
  }
  if (!/(^|\.)supabase\.(com|co)$/.test(host)) return undefined;
  if (new URL(connectionString).searchParams.has('sslmode')) return undefined;
  return ca?.trim() ? { ca: ca.replace(/\\n/g, '\n') } : { rejectUnauthorized: false };
}

export function createDb(connectionString: string, max = 10): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max, ssl: sslFor(connectionString) }),
    }),
  });
}
