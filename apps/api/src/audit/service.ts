import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { newId } from '../lib/crypto.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface AuditContext {
  actorId: string | null;
  requestId: string | null;
  ip: string | null;
}

/** Fields never written to the audit log (SEC-15). */
const REDACT = new Set(['password_hash', 'token_hash', 'code_hash', 'csrf_token', 'passwordHash']);

function clean(value: Record<string, unknown> | null | undefined): string | undefined {
  if (!value) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT.has(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return JSON.stringify(out);
}

/**
 * Writes one append-only audit event (SH-08). Call inside the same transaction as the change,
 * so a change is never saved without its audit record.
 */
export async function audit(
  db: Executor,
  ctx: AuditContext,
  event: {
    action: string;
    entityType: string;
    entityId: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db
    .insertInto('audit_events')
    .values({
      id: newId(),
      actor_id: ctx.actorId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      request_id: ctx.requestId,
      before: clean(event.before),
      after: clean(event.after),
      ip: ctx.ip,
    })
    .execute();
}
