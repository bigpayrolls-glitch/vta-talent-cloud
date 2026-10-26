/**
 * Phase 10: backup, and a restore drill that proves the backup works (requirements §15: "tested restore procedure").
 *
 *   pnpm --filter @vta/api backup                     # writes backups/vta-<time>.dump from DATABASE_URL
 *   RESTORE_DATABASE_URL=postgres://…/vta_restore_check pnpm --filter @vta/api backup -- --drill
 *
 * The drill restores the new backup into RESTORE_DATABASE_URL (a scratch database that is wiped first), then
 * compares every table's row count and checks the database rules (append-only triggers) came back too.
 * It exits with an error if anything differs. Needs pg_dump/pg_restore at least as new as the server.
 * Uploaded files: with STORAGE_DRIVER=database they are inside this backup; with local disk storage,
 * back up STORAGE_DIR as well.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { createDb, type DB } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!source) throw new Error('Set DATABASE_URL (the database to back up).');
const drill = process.argv.includes('--drill');
const target = process.env.RESTORE_DATABASE_URL;
if (drill && !target) throw new Error('Set RESTORE_DATABASE_URL to a scratch database for the drill (it is wiped).');
if (drill && target === source) throw new Error('RESTORE_DATABASE_URL must not be the database being backed up.');

const dir = path.resolve(here, '../../../../backups');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `vta-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
console.log(`Backing up to ${file}`);
execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${file}`, source], { stdio: 'inherit' });
console.log(`Backup written (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB).`);

async function counts(db: DB): Promise<Map<string, number>> {
  const { rows } = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`.execute(db);
  const out = new Map<string, number>();
  for (const r of rows) {
    const { rows: c } = await sql<{ n: string }>`select count(*) as n from ${sql.table(r.table_name)}`.execute(db);
    out.set(r.table_name, Number(c[0]!.n));
  }
  return out;
}
const triggers = async (db: DB) =>
  (await sql<{ t: string }>`select event_object_table || '.' || trigger_name as t from information_schema.triggers where trigger_schema = 'public' order by 1`.execute(db)).rows.map((r) => r.t);

if (drill) {
  const src = createDb(source, 1);
  const dst = createDb(target!, 1);
  try {
    console.log('Restoring into the scratch database…');
    await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(dst);
    execFileSync('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', `--dbname=${target}`, file], { stdio: 'inherit' });
    const [a, b] = [await counts(src), await counts(dst)];
    const problems: string[] = [];
    for (const [t, n] of a) if (b.get(t) !== n) problems.push(`${t}: ${n} in the source, ${b.get(t) ?? 'missing'} restored`);
    const [ta, tb] = [await triggers(src), await triggers(dst)];
    for (const t of ta) if (!tb.includes(t)) problems.push(`trigger ${t} missing after restore`);
    const total = [...a.values()].reduce((x, y) => x + y, 0);
    console.log(`Compared ${a.size} tables (${total.toLocaleString('en-IN')} rows) and ${ta.length} database rules.`);
    if (problems.length) {
      console.error(`RESTORE DRILL FAILED:\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log('Restore drill passed: every table and rule came back.');
    }
  } finally {
    await src.destroy();
    await dst.destroy();
  }
}
