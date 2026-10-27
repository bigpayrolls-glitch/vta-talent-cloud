import { sql, type Kysely } from 'kysely';

/**
 * Real SMS (Message Central VerifyNow): the provider makes and checks the code itself, so a challenge keeps
 * the provider's verification reference instead of a code hash.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE otp_challenges ADD COLUMN provider_ref text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE otp_challenges DROP COLUMN provider_ref`.execute(db);
}
