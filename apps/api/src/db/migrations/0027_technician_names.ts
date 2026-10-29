import { sql, type Kysely } from 'kysely';

/**
 * 29 Oct 2026: the Technician journey courses take the names on AutoTalent Grid's course pictures.
 * Only a course still carrying its first name is renamed, so an Admin's own change is kept.
 */
const RENAME: [code: string, from: string, to: string][] = [
  ['ATG-TECH-1', 'Technician Beginner: 7 Brands 18 Points Check Up', 'Jr Technician: Beginner Certification'],
  ['ATG-TECH-2', 'Technician Bronze: Body Work and Accidental Work', 'Technician: Bronze Level Certification'],
  ['ATG-TECH-3', 'Technician Silver: Half Engine and Full Engine', 'Senior Technician: Silver Level Certification'],
  ['ATG-TECH-4', 'Technician Expert: Troubleshooting: Electrical and Mechanical', 'Expert Technician: Expert Level Certification'],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [code, from, to] of RENAME) {
    await sql`UPDATE courses SET title = ${to}, updated_at = now() WHERE code = ${code} AND title = ${from}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const [code, from, to] of RENAME) {
    await sql`UPDATE courses SET title = ${from} WHERE code = ${code} AND title = ${to}`.execute(db);
  }
}
