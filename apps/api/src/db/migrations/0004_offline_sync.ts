import { sql, type Kysely } from 'kysely';

/**
 * Phase 4: offline attendance sync (TR-04).
 * Every change a phone sends carries an operation id made on the phone. The outcome of each one is kept here,
 * so a change that arrives twice (the phone retried after a dropped connection) is never applied twice,
 * even if a later change has since overwritten the same mark.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE attendance_sync_ops (
      op_id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      batch_id uuid NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('applied','unchanged','conflict','rejected')),
      message text,
      captured_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX attendance_sync_ops_user_idx ON attendance_sync_ops (user_id, received_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS attendance_sync_ops;`.execute(db);
}
