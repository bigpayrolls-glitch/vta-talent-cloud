import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings, not JS Dates shifted by time zone.
pg.types.setTypeParser(1082, (v) => v);

export type DB = Kysely<Database>;

export function createDb(connectionString: string): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10 }),
    }),
  });
}
