import {
  ageOn,
  CANDIDATE_STATUSES,
  candidateSchema,
  candidateUpdateSchema,
  listQuerySchema,
  reasonSchema,
  SKILL_AREAS,
  uuidSchema,
  type Page,
} from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { notify } from '../../lib/notify.js';
import { csvToRecords } from '../../lib/csv.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';
import { candidateReadScope, inScope } from '../../policy/index.js';
import { createCandidate, findPossibleDuplicate, type CandidateInput } from './candidateService.js';
import { consentRequired, consentState } from '../learner/service.js';

const idParam = z.object({ id: uuidSchema });

const filterSchema = listQuerySchema.extend({
  verificationStatus: z.enum(CANDIDATE_STATUSES).optional(),
  skillArea: z.enum(SKILL_AREAS).optional(),
  city: z.string().trim().max(80).optional(),
  duplicates: z.enum(['true']).optional(),
});

export const IMPORT_MAX_ROWS = 500;
const IMPORT_COLUMNS = ['name', 'phone', 'date_of_birth', 'city', 'state', 'skill_areas', 'experience_months', 'email', 'education', 'languages'] as const;
const REQUIRED_COLUMNS = ['name', 'phone', 'date_of_birth', 'city'];

const splitList = (v: string | undefined) =>
  (v ?? '')
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

export const candidateRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** T-05: server-side search. Centre admins see only candidates enrolled at their centres. */
  app.get('/admin/candidates', { config: { permission: 'candidate.read' } }, async (req): Promise<Page<unknown>> => {
    const f = parse(filterSchema, req.query);
    const scope = await candidateReadScope(db, req.actor!);
    if (scope !== 'all' && scope.length === 0) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
    let q = db.selectFrom('candidate_profiles as cp').innerJoin('users as u', 'u.id', 'cp.user_id');
    if (scope !== 'all') q = q.where('u.id', 'in', scope);
    if (f.verificationStatus) q = q.where('cp.verification_status', '=', f.verificationStatus);
    if (f.skillArea) q = q.where((eb) => eb(eb.val(f.skillArea!), '=', eb.fn.any('cp.skill_areas')));
    if (f.city) q = q.where('cp.city', 'ilike', f.city.replace(/[%_\\]/g, '\\$&'));
    if (f.duplicates) q = q.where('cp.duplicate_of', 'is not', null);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      const digits = f.q.replace(/\D/g, '');
      q = q.where((eb) =>
        eb.or([
          eb('u.name', 'ilike', like),
          eb('cp.candidate_code', 'ilike', like),
          ...(digits.length >= 4 ? [eb('u.phone', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['u.id', 'u.name', 'u.phone', 'u.status as user_status', 'cp.candidate_code', 'cp.city', 'cp.skill_areas', 'cp.experience_months', 'cp.verification_status', 'cp.duplicate_of', 'cp.created_at'])
      .orderBy('cp.created_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.candidate_code,
        name: r.name,
        phone: r.phone,
        city: r.city,
        skillAreas: r.skill_areas,
        experienceMonths: r.experience_months,
        verificationStatus: r.verification_status,
        possibleDuplicate: !!r.duplicate_of,
        userStatus: r.user_status,
        createdAt: iso(r.created_at),
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/admin/candidates/:id', { config: { permission: 'candidate.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!inScope(await candidateReadScope(db, req.actor!), id)) throw notFound('Candidate');
    const c = await db
      .selectFrom('candidate_profiles as cp')
      .innerJoin('users as u', 'u.id', 'cp.user_id')
      .leftJoin('users as vb', 'vb.id', 'cp.verified_by')
      .selectAll('cp')
      .select(['u.name', 'u.phone', 'u.email', 'u.date_of_birth', 'u.status as user_status', 'u.last_login_at', 'vb.name as verified_by_name'])
      .where('cp.user_id', '=', id)
      .executeTakeFirst();
    if (!c) throw notFound('Candidate');
    const duplicate = c.duplicate_of
      ? await db
          .selectFrom('candidate_profiles as cp')
          .innerJoin('users as u', 'u.id', 'cp.user_id')
          .select(['u.id', 'u.name', 'cp.candidate_code', 'cp.city', 'u.status'])
          .where('u.id', '=', c.duplicate_of)
          .executeTakeFirst()
      : undefined;
    const enrolments = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as co', 'co.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select(['e.id', 'e.status', 'e.enrolled_at', 'b.id as batch_id', 'b.name as batch_name', 'b.status as batch_status', 'co.title as course_title', 'ce.name as centre_name'])
      .where('e.candidate_id', '=', id)
      .orderBy('e.enrolled_at', 'desc')
      .execute();
    const documents = await db
      .selectFrom('documents')
      .select(['id', 'kind', 'title', 'original_name', 'mime_type', 'size_bytes', 'verification_status', 'review_reason', 'scan_status', 'visibility', 'uploaded_by', 'created_at'])
      .where('owner_user_id', '=', id)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    // SH-05: staff can see whether the person has accepted the current notice (not change it for them).
    const consents = await consentState(db, id);
    return {
      id: c.user_id,
      code: c.candidate_code,
      name: c.name,
      phone: c.phone,
      email: c.email,
      dateOfBirth: c.date_of_birth,
      age: c.date_of_birth ? ageOn(c.date_of_birth) : null,
      city: c.city,
      state: c.state,
      skillAreas: c.skill_areas,
      experienceMonths: c.experience_months,
      education: c.education,
      languages: c.languages,
      searchable: c.searchable,
      verificationStatus: c.verification_status,
      verificationReason: c.verification_reason,
      verifiedAt: iso(c.verified_at),
      verifiedByName: c.verified_by_name,
      source: c.source,
      noticeAccepted: !(await consentRequired(db, id)),
      noticeAcceptedAt: iso(consents.get('privacy_notice')?.at ?? null),
      userStatus: c.user_status,
      lastLoginAt: iso(c.last_login_at),
      createdAt: iso(c.created_at),
      possibleDuplicate: duplicate ? { id: duplicate.id, name: duplicate.name, code: duplicate.candidate_code, city: duplicate.city, status: duplicate.status } : null,
      enrolments: enrolments.map((e) => ({
        id: e.id,
        status: e.status,
        enrolledAt: iso(e.enrolled_at),
        batchId: e.batch_id,
        batchName: e.batch_name,
        batchStatus: e.batch_status,
        courseTitle: e.course_title,
        centreName: e.centre_name,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        fileName: d.original_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        verificationStatus: d.verification_status,
        reviewReason: d.review_reason,
        scanStatus: d.scan_status,
        visibility: d.visibility,
        uploadedBySelf: d.uploaded_by === id,
        createdAt: iso(d.created_at),
      })),
    };
  });

  async function assertContactFree(input: { phone?: string; email?: string }, excludeUserId?: string) {
    const fields: Record<string, string> = {};
    if (input.phone) {
      let q = db.selectFrom('users').select('id').where('phone', '=', input.phone);
      if (excludeUserId) q = q.where('id', '!=', excludeUserId);
      if (await q.executeTakeFirst()) fields.phone = 'Already registered';
    }
    if (input.email) {
      let q = db.selectFrom('users').select('id').where('email', '=', input.email);
      if (excludeUserId) q = q.where('id', '!=', excludeUserId);
      if (await q.executeTakeFirst()) fields.email = 'Already in use';
    }
    if (Object.keys(fields).length) throw conflict('Someone is already registered with these details', fields);
  }

  /** T-03: admin creates a candidate. They stay invited until they sign in by phone. */
  app.post('/admin/candidates', { config: { permission: 'candidate.manage' } }, async (req, reply) => {
    const b = parse(candidateSchema, req.body);
    await assertContactFree(b);
    const result = await db.transaction().execute((trx) => createCandidate(trx, req, b, 'admin'));
    reply.code(201);
    return { id: result.id, code: result.code, possibleDuplicate: !!result.duplicateOf };
  });

  app.patch('/admin/candidates/:id', { config: { permission: 'candidate.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(candidateUpdateSchema, req.body);
    const cur = await db
      .selectFrom('candidate_profiles as cp')
      .innerJoin('users as u', 'u.id', 'cp.user_id')
      .selectAll('cp')
      .select(['u.name', 'u.email', 'u.date_of_birth'])
      .where('cp.user_id', '=', id)
      .executeTakeFirst();
    if (!cur) throw notFound('Candidate');
    if (b.email && b.email !== cur.email) await assertContactFree({ email: b.email }, id);

    const userChanges = {
      ...(b.name !== undefined && b.name !== cur.name && { name: b.name }),
      ...(b.email !== undefined && b.email !== cur.email && { email: b.email }),
      ...(b.dateOfBirth !== undefined && b.dateOfBirth !== cur.date_of_birth && { date_of_birth: b.dateOfBirth }),
    };
    const profileChanges = {
      ...(b.city !== undefined && b.city !== cur.city && { city: b.city }),
      ...(b.state !== undefined && b.state !== cur.state && { state: b.state }),
      ...(b.skillAreas !== undefined && { skill_areas: b.skillAreas }),
      ...(b.experienceMonths !== undefined && b.experienceMonths !== cur.experience_months && { experience_months: b.experienceMonths }),
      ...(b.education !== undefined && b.education !== cur.education && { education: b.education }),
      ...(b.languages !== undefined && { languages: b.languages }),
    };
    // Name or birth date changed: check again for a possible duplicate.
    let duplicateOf: string | null | undefined;
    if ('name' in userChanges || 'date_of_birth' in userChanges) {
      duplicateOf = await findPossibleDuplicate(db, (userChanges.name as string) ?? cur.name, (userChanges.date_of_birth as string) ?? cur.date_of_birth!, id);
    }
    await db.transaction().execute(async (trx) => {
      if (Object.keys(userChanges).length) await trx.updateTable('users').set({ ...userChanges, updated_at: new Date() }).where('id', '=', id).execute();
      await trx
        .updateTable('candidate_profiles')
        .set({ ...profileChanges, ...(duplicateOf !== undefined && { duplicate_of: duplicateOf }), updated_at: new Date() })
        .where('user_id', '=', id)
        .execute();
      // SH-04: profile edits are timestamped and their before/after kept in the audit log.
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(userChanges)) before[k] = cur[k as 'name'];
      for (const k of Object.keys(profileChanges)) before[k] = cur[k as 'city'];
      await audit(trx, auditCtx(req), { action: 'candidate.updated', entityType: 'user', entityId: id, before, after: { ...userChanges, ...profileChanges } });
    });
    return { id, possibleDuplicate: duplicateOf === undefined ? !!cur.duplicate_of : !!duplicateOf };
  });

  /** AD-05: verification decisions. Verifying is blocked while a possible duplicate is unresolved. */
  const decisions = [
    { path: 'verify', to: 'verified', needsReason: false },
    { path: 'reject', to: 'rejected', needsReason: true },
    { path: 'request-correction', to: 'needs_correction', needsReason: true },
  ] as const;
  for (const d of decisions) {
    app.post(`/admin/candidates/:id/${d.path}`, { config: { permission: 'candidate.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = d.needsReason ? parse(reasonSchema, req.body).reason : null;
      const cp = await db.selectFrom('candidate_profiles').selectAll().where('user_id', '=', id).executeTakeFirst();
      if (!cp) throw notFound('Candidate');
      if (cp.verification_status === d.to) throw invalid(`This candidate is already ${d.to.replace(/_/g, ' ')}.`);
      if (d.to === 'verified' && cp.duplicate_of) throw invalid('Review the possible duplicate before verifying this candidate.');
      const now = new Date();
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('candidate_profiles')
          .set({
            verification_status: d.to,
            verification_reason: reason,
            verified_by: d.to === 'verified' ? req.actor!.userId : null,
            verified_at: d.to === 'verified' ? now : null,
            updated_at: now,
          })
          .where('user_id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), {
          action: `candidate.${d.to}`,
          entityType: 'user',
          entityId: id,
          before: { verification_status: cp.verification_status },
          after: { verification_status: d.to, reason },
        });
        const tpl = ({ verified: 'profile_verified', rejected: 'profile_rejected', needs_correction: 'profile_correction' } as const)[d.to];
        await notify(trx, [id], tpl, { reason }, '/learn/profile');
      });
      return { id, verificationStatus: d.to };
    });
  }

  /** The admin checked the possible duplicate and it is a different person. */
  app.post('/admin/candidates/:id/dismiss-duplicate', { config: { permission: 'candidate.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const cp = await db.selectFrom('candidate_profiles').select(['duplicate_of']).where('user_id', '=', id).executeTakeFirst();
    if (!cp) throw notFound('Candidate');
    if (!cp.duplicate_of) throw invalid('This candidate is not flagged as a possible duplicate.');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('candidate_profiles').set({ duplicate_of: null, updated_at: new Date() }).where('user_id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'candidate.duplicate_dismissed', entityType: 'user', entityId: id, before: { duplicate_of: cp.duplicate_of }, after: { duplicate_of: null } });
    });
    return { id };
  });

  /**
   * T-03: CSV import in two steps. `commit: false` checks every row and reports problems;
   * `commit: true` imports the valid rows in one transaction. Rows with errors are never imported.
   */
  app.post('/admin/candidates/import', { config: { permission: 'candidate.manage' } }, async (req) => {
    const { csv, commit } = parse(z.object({ csv: z.string().min(1, 'Choose a CSV file').max(600_000, 'The file is too large'), commit: z.boolean().default(false) }), req.body);
    const { headers, records } = csvToRecords(csv);
    const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
    if (missing.length) throw invalid(`The file is missing these columns: ${missing.join(', ')}`, { csv: `Expected columns: ${IMPORT_COLUMNS.join(', ')}` });
    if (records.length === 0) throw invalid('The file has no candidate rows.', { csv: 'No rows' });
    if (records.length > IMPORT_MAX_ROWS) throw invalid(`Import at most ${IMPORT_MAX_ROWS} candidates at a time.`, { csv: `${records.length} rows` });

    type Row = { row: number; name: string; phone: string; status: 'ready' | 'possible_duplicate' | 'error'; messages: string[]; input?: CandidateInput };
    const t0 = Date.now();
    req.log.info({ rows: records.length, commit }, 'candidate import: checking rows');

    // 1. Check each row on its own (no database).
    const parsedRows = records.map((r, i) => {
      const raw = {
        name: r.name,
        phone: r.phone,
        dateOfBirth: r.date_of_birth,
        city: r.city,
        state: r.state || undefined,
        email: r.email || undefined,
        education: r.education || undefined,
        experienceMonths: r.experience_months || 0,
        skillAreas: splitList(r.skill_areas).map((s) => (s.toLowerCase() === 'other' ? 'other' : s.toUpperCase())),
        languages: splitList(r.languages),
      };
      return { rowNo: i + 2, r, parsed: candidateSchema.safeParse(raw) }; // header is row 1
    });
    const valid = parsedRows.flatMap((p) => (p.parsed.success ? [p.parsed.data] : []));

    // 2. Three database lookups for the whole file, whatever its size (not three per row).
    const phones = [...new Set(valid.map((v) => v.phone))];
    const emails = [...new Set(valid.flatMap((v) => (v.email ? [v.email] : [])))];
    const takenPhones = new Set(phones.length ? (await db.selectFrom('users').select('phone').where('phone', 'in', phones).execute()).map((u) => u.phone) : []);
    const takenEmails = new Set(emails.length ? (await db.selectFrom('users').select('email').where('email', 'in', emails).execute()).map((u) => u.email) : []);
    const normName = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
    const dobs = [...new Set(valid.map((v) => v.dateOfBirth))];
    const sameDob = dobs.length
      ? await db
          .selectFrom('users as u')
          .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
          .select(['u.name', 'u.date_of_birth'])
          .where('u.date_of_birth', 'in', dobs)
          .where('u.status', '!=', 'deactivated')
          .execute()
      : [];
    const existingPeople = new Set(sameDob.map((u) => `${normName(u.name)}|${u.date_of_birth}`));
    req.log.info({ ms: Date.now() - t0 }, 'candidate import: database checks done');

    const results: Row[] = [];
    const seenPhones = new Map<string, number>();
    for (const { rowNo, r, parsed } of parsedRows) {
      if (!parsed.success) {
        const msgs = [...new Set(parsed.error.issues.map((x) => `${String(x.path[0] ?? 'row')}: ${x.message}`))];
        results.push({ row: rowNo, name: r.name ?? '', phone: r.phone ?? '', status: 'error', messages: msgs });
        continue;
      }
      const input = parsed.data;
      const messages: string[] = [];
      const firstRow = seenPhones.get(input.phone);
      if (firstRow) messages.push(`phone: Same number as row ${firstRow}`);
      else seenPhones.set(input.phone, rowNo);
      if (takenPhones.has(input.phone)) messages.push('phone: Already registered');
      if (input.email && takenEmails.has(input.email)) messages.push('email: Already in use');
      if (messages.length) {
        results.push({ row: rowNo, name: input.name, phone: input.phone, status: 'error', messages });
        continue;
      }
      const dup = existingPeople.has(`${normName(input.name)}|${input.dateOfBirth}`);
      results.push({
        row: rowNo,
        name: input.name,
        phone: input.phone,
        status: dup ? 'possible_duplicate' : 'ready',
        messages: dup ? ['Same name and date of birth as an existing candidate. Imported and flagged for review.'] : [],
        input,
      });
    }

    const importable = results.filter((r) => r.status !== 'error');
    const summary = {
      total: results.length,
      ready: results.filter((r) => r.status === 'ready').length,
      possibleDuplicates: results.filter((r) => r.status === 'possible_duplicate').length,
      errors: results.filter((r) => r.status === 'error').length,
    };
    let imported = 0;
    if (commit && importable.length) {
      await db.transaction().execute(async (trx) => {
        for (const r of importable) {
          await createCandidate(trx, req, r.input!, 'import');
          imported++;
        }
        await audit(trx, auditCtx(req), { action: 'candidate.import_completed', entityType: 'user', entityId: null, after: { ...summary, imported } });
      });
    }
    req.log.info({ ms: Date.now() - t0, ...summary, imported }, 'candidate import: finished');
    return {
      committed: commit,
      imported,
      summary,
      rows: results.map(({ input: _input, ...r }) => r),
    };
  });
};
