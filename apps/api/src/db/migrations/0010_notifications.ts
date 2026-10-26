import { sql, type Kysely } from 'kysely';

/**
 * Phase 9.
 * - notifications (SH-07, data model §12): recipient, template, channel, delivery state, created_at.
 * - password_resets: single-use, short-lived email links; only the hash is stored.
 * - account_requests: a learner asks VTA to close their account; VTA records the outcome.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE notifications (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      template text NOT NULL,
      params jsonb NOT NULL DEFAULT '{}'::jsonb,
      link text,
      channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'sms', 'email', 'whatsapp')),
      delivery_state text NOT NULL DEFAULT 'delivered' CHECK (delivery_state IN ('pending', 'delivered', 'failed', 'skipped')),
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_user_created ON notifications (user_id, created_at DESC);
    CREATE INDEX notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

    CREATE TABLE password_resets (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX password_resets_user ON password_resets (user_id);

    CREATE TABLE account_requests (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('closure')),
      reason text,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'declined', 'cancelled')),
      resolution_note text,
      resolved_by uuid REFERENCES users(id),
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- One open request per person.
    CREATE UNIQUE INDEX account_requests_one_open ON account_requests (user_id, kind) WHERE status = 'open';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS account_requests; DROP TABLE IF EXISTS password_resets; DROP TABLE IF EXISTS notifications;`.execute(db);
}
