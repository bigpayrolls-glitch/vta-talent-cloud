import {
  BENEFICIARY_FIELD_LABEL,
  PROGRAMME_DOCUMENT_CATEGORIES,
  programmeSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  uuidSchema,
  type BeneficiaryField,
} from '@vta/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Database, Programme } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { toCsv } from '../../lib/csv.js';
import { forbidden, invalid, notFound } from '../../lib/errors.js';
import { LINK_TTL_SECONDS, safeFileName, signLink, sniffMime } from '../../lib/storage.js';
import { notify, orgMembers, PARTNER_TEAM } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { isPlatformAdmin } from '../../policy/index.js';
import { attendanceByCandidate } from '../operations/common.js';
import { cohortMetrics, metricRate } from './metrics.js';

const idParam = z.object({ id: uuidSchema });

/** Partner organisations the actor belongs to. */
const partnerOrgs = (req: FastifyRequest) =>
  [...new Set(req.actor!.assignments.filter((a) => a.role === 'partner_admin' && a.organisationId).map((a) => a.organisationId!))];

/**
 * AD-10 and PA-02 to PA-06. VTA staff manage programmes; partners see only programmes assigned to their
 * organisation (anything else is "not found"), only the beneficiary fields approved for that programme,
 * and aggregate reports without personal data.
 */
export const programmeRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** A programme the actor may see. */
  const visible = async (req: FastifyRequest, id: string): Promise<Programme> => {
    const p = await db.selectFrom('programmes').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('Programme');
    if (isPlatformAdmin(req.actor!)) return p;
    const orgs = partnerOrgs(req);
    const link = orgs.length ? await db.selectFrom('programme_partners').select('programme_id').where('programme_id', '=', id).where('organisation_id', 'in', orgs).executeTakeFirst() : null;
    if (!link) throw notFound('Programme');
    return p;
  };

  const links = async (ids: string[]) => {
    if (!ids.length) return { partners: [], batches: [] };
    const partners = await db
      .selectFrom('programme_partners as pp')
      .innerJoin('organisations as o', 'o.id', 'pp.organisation_id')
      .select(['pp.programme_id', 'o.id', 'o.legal_name'])
      .where('pp.programme_id', 'in', ids)
      .execute();
    const batches = await db
      .selectFrom('programme_batches as pb')
      .innerJoin('batches as b', 'b.id', 'pb.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select(['pb.programme_id', 'b.id', 'b.name', 'b.status', 'b.start_date', 'b.end_date', 'c.title as course', 'ce.name as centre'])
      .where('pb.programme_id', 'in', ids)
      .orderBy('b.start_date')
      .execute();
    return { partners, batches };
  };

  const dto = async (req: FastifyRequest, p: Programme) => {
    const { partners, batches } = await links([p.id]);
    const sponsor = p.sponsor_organisation_id ? await db.selectFrom('organisations').select(['id', 'legal_name']).where('id', '=', p.sponsor_organisation_id).executeTakeFirst() : null;
    const admin = isPlatformAdmin(req.actor!);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sponsor: sponsor ? { id: sponsor.id, name: sponsor.legal_name } : null,
      partners: partners.map((x) => ({ id: x.id, name: x.legal_name })),
      batches: batches.map((b) => ({ id: b.id, name: b.name, status: b.status, startDate: b.start_date, endDate: b.end_date, course: b.course, centre: b.centre })),
      targetCount: p.target_count,
      startDate: p.start_date,
      endDate: p.end_date,
      status: p.status,
      reportingRequirements: p.reporting_requirements,
      beneficiaryFields: p.beneficiary_fields,
      sharingBasis: p.sharing_basis,
      // A manually approved reference only (never finance data), always with its source and date (§17).
      budget: p.budget_amount != null || p.budget_reference ? { reference: p.budget_reference, amount: p.budget_amount != null ? Number(p.budget_amount) : null, source: p.budget_source, asOf: p.budget_as_of } : null,
      canManage: admin,
      canUpload: admin || req.actor!.assignments.some((a) => a.role === 'partner_admin' && partners.some((x) => x.id === a.organisationId)),
      createdAt: iso(p.created_at),
    };
  };

  // ---------------------------------------------------------------- list and read (PA-02)

  /** SH-09: paged, with search by name and a status filter. */
  const listSchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['planned', 'active', 'closed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  app.get('/programmes', { config: { permission: 'programme.read' } }, async (req) => {
    const f = parse(listSchema, req.query);
    let q = db.selectFrom('programmes');
    if (!isPlatformAdmin(req.actor!)) {
      const orgs = partnerOrgs(req);
      if (!orgs.length) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
      q = q.where('id', 'in', db.selectFrom('programme_partners').select('programme_id').where('organisation_id', 'in', orgs));
    }
    if (f.q) q = q.where('name', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    if (f.status) q = q.where('status', '=', f.status);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('start_date', 'desc').orderBy('id').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute();
    const { partners, batches } = await links(rows.map((r) => r.id));
    const enrolled = rows.length
      ? await db
          .selectFrom('programme_batches as pb')
          .innerJoin('enrolments as e', 'e.batch_id', 'pb.batch_id')
          .select(['pb.programme_id', sql<string>`count(*)`.as('n')])
          .where('pb.programme_id', 'in', rows.map((r) => r.id))
          .where('e.status', '!=', 'withdrawn')
          .groupBy('pb.programme_id')
          .execute()
      : [];
    return {
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        startDate: p.start_date,
        endDate: p.end_date,
        targetCount: p.target_count,
        enrolled: Number(enrolled.find((e) => e.programme_id === p.id)?.n ?? 0),
        partners: partners.filter((x) => x.programme_id === p.id).map((x) => x.legal_name),
        batches: batches.filter((b) => b.programme_id === p.id).length,
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/programmes/:id', { config: { permission: 'programme.read' } }, async (req) => dto(req, await visible(req, parse(idParam, req.params).id)));

  /** PA-03: the programme dashboard, every figure with its definition. */
  app.get('/programmes/:id/metrics', { config: { permission: 'programme.read' } }, async (req) => {
    const p = await visible(req, parse(idParam, req.params).id);
    const batchIds = (await db.selectFrom('programme_batches').select('batch_id').where('programme_id', '=', p.id).execute()).map((b) => b.batch_id);
    return cohortMetrics(db, batchIds, p.target_count);
  });

  // ---------------------------------------------------------------- beneficiaries (PA-04)

  const beneficiaries = async (p: Programme) => {
    const fields = p.beneficiary_fields as BeneficiaryField[];
    const has = (f: BeneficiaryField) => fields.includes(f);
    const rows = await db
      .selectFrom('programme_batches as pb')
      .innerJoin('enrolments as e', 'e.batch_id', 'pb.batch_id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'e.candidate_id')
      .select(['e.id', 'e.candidate_id', 'e.status', 'e.enrolled_at', 'e.attendance_pct', 'b.id as batch_id', 'b.name as batch_name', 'u.name', 'u.phone', 'u.date_of_birth', 'cp.candidate_code', 'cp.city'])
      .where('pb.programme_id', '=', p.id)
      .orderBy('b.start_date')
      .orderBy('cp.candidate_code')
      .execute();
    const ids = rows.map((r) => r.id);
    const results = ids.length && has('assessment') ? await db.selectFrom('assessment_results').select(['enrolment_id', 'outcome']).where('enrolment_id', 'in', ids).where('status', '=', 'approved').execute() : [];
    const anyResult = ids.length && has('assessment') ? await db.selectFrom('assessment_results').select('enrolment_id').where('enrolment_id', 'in', ids).execute() : [];
    const creds = ids.length && has('certificate') ? await db.selectFrom('credentials').select('enrolment_id').where('enrolment_id', 'in', ids).where('status', '=', 'active').execute() : [];
    const apps =
      rows.length && has('employment')
        ? await db
            .selectFrom('job_applications')
            .select(['candidate_id', 'status', 'outcome_verification', 'applied_at'])
            .where('candidate_id', 'in', [...new Set(rows.map((r) => r.candidate_id))])
            .where('status', 'in', ['offer', 'joined', 'not_joined'])
            .execute()
        : [];
    // Live attendance for running batches; the stored figure once a batch is completed.
    const live = new Map<string, Map<string, number | null>>();
    if (has('attendance')) {
      for (const batchId of new Set(rows.filter((r) => r.attendance_pct === null).map((r) => r.batch_id))) {
        const { byCandidate } = await attendanceByCandidate(db, batchId);
        live.set(batchId, new Map([...byCandidate.entries()].map(([k, v]) => [k, v.pct])));
      }
    }
    return rows.map((r) => {
      const out: Record<string, string | number | null> = {};
      if (has('candidateCode')) out.candidateCode = r.candidate_code;
      if (has('name')) out.name = r.name;
      if (has('phone')) out.phone = r.phone;
      if (has('dateOfBirth')) out.dateOfBirth = r.date_of_birth;
      if (has('city')) out.city = r.city;
      if (has('batch')) out.batch = r.batch_name;
      if (has('enrolmentStatus')) out.enrolmentStatus = r.status;
      if (has('attendance')) out.attendance = r.attendance_pct !== null ? Number(r.attendance_pct) : (live.get(r.batch_id)?.get(r.candidate_id) ?? null);
      if (has('assessment')) {
        const res = results.find((x) => x.enrolment_id === r.id);
        out.assessment = res ? (res.outcome === 'pass' ? 'Passed' : 'Not passed') : anyResult.some((x) => x.enrolment_id === r.id) ? 'In progress' : 'Not assessed';
      }
      if (has('certificate')) out.certificate = creds.some((c) => c.enrolment_id === r.id) ? 'Issued' : 'No';
      if (has('employment')) {
        const mine = apps.filter((a) => a.candidate_id === r.candidate_id && a.applied_at >= r.enrolled_at);
        out.employment = mine.some((a) => a.status === 'joined' && a.outcome_verification === 'verified')
          ? 'Joined (AutoTalent Grid-verified)'
          : mine.some((a) => a.status === 'joined')
            ? 'Joined (employer-reported)'
            : mine.length
              ? 'Offer'
              : 'None recorded';
      }
      return out;
    });
  };

  app.get('/programmes/:id/beneficiaries', { config: { permission: 'programme.read' } }, async (req) => {
    const p = await visible(req, parse(idParam, req.params).id);
    // SH-09: paged (the CSV download still has everyone).
    const f = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    const all = await beneficiaries(p);
    return { fields: p.beneficiary_fields, sharingBasis: p.sharing_basis, items: all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize), page: f.page, pageSize: f.pageSize, total: all.length };
  });

  // ---------------------------------------------------------------- downloads (PA-06): logged, no personal data unless approved

  const sendCsv = (reply: FastifyReply, name: string, csv: string) =>
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).header('cache-control', 'private, no-store').send(csv);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  app.get('/programmes/:id/report.csv', { config: { permission: 'programme.read' } }, async (req, reply) => {
    const p = await visible(req, parse(idParam, req.params).id);
    const batchIds = (await db.selectFrom('programme_batches').select('batch_id').where('programme_id', '=', p.id).execute()).map((b) => b.batch_id);
    const { metrics, asOf } = await cohortMetrics(db, batchIds, p.target_count);
    await audit(db, auditCtx(req), { action: 'report.exported', entityType: 'programme', entityId: p.id, after: { report: 'programme_outcomes', personalData: false } });
    return sendCsv(reply, `${slug(p.name)}-outcomes.csv`, toCsv([
      ['Programme', p.name],
      ['As of', asOf],
      ['Note', 'Aggregate figures only. No personal data.'],
      [],
      ['Measure', 'Value', 'Out of', 'Rate %', 'Type', 'Definition'],
      ...metrics.map((m) => [m.label, m.value, m.denominator ? `${m.denominator.value} (${m.denominator.label})` : '', metricRate(m) ?? '', m.basis.replace('_', ' '), m.definition]),
    ]));
  });

  app.get('/programmes/:id/beneficiaries.csv', { config: { permission: 'programme.read' } }, async (req, reply) => {
    const p = await visible(req, parse(idParam, req.params).id);
    const fields = p.beneficiary_fields as BeneficiaryField[];
    const rows = await beneficiaries(p);
    await audit(db, auditCtx(req), { action: 'report.exported', entityType: 'programme', entityId: p.id, after: { report: 'beneficiaries', fields, rows: rows.length } });
    return sendCsv(reply, `${slug(p.name)}-beneficiaries.csv`, toCsv([fields.map((f) => BENEFICIARY_FIELD_LABEL[f]), ...rows.map((r) => fields.map((f) => r[f] ?? ''))]));
  });

  // ---------------------------------------------------------------- documents (PA-05)

  app.get('/programmes/:id/documents', { config: { permission: 'programme.read' } }, async (req) => {
    const p = await visible(req, parse(idParam, req.params).id);
    const rows = await db
      .selectFrom('documents as d')
      .leftJoin('users as u', 'u.id', 'd.uploaded_by')
      .select(['d.id', 'd.title', 'd.category', 'd.mime_type', 'd.size_bytes', 'd.created_at', 'u.name as uploaded_by'])
      .where('d.programme_id', '=', p.id)
      .where('d.deleted_at', 'is', null)
      .orderBy('d.created_at', 'desc')
      .execute();
    return { items: rows.map((d) => ({ id: d.id, title: d.title, category: d.category, mimeType: d.mime_type, sizeBytes: d.size_bytes, uploadedBy: d.uploaded_by, createdAt: iso(d.created_at) })) };
  });

  app.post('/programmes/:id/documents', { config: { permission: 'programme.documents.upload' }, bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
    const p = await visible(req, parse(idParam, req.params).id);
    if (!(await dto(req, p)).canUpload) throw forbidden('Only AutoTalent Grid staff and the programme partner’s admins can add documents.');
    const meta = parse(z.object({ title: z.string().trim().min(2, 'Give the document a title').max(120), fileName: z.string().trim().min(1).max(200), category: z.enum(PROGRAMME_DOCUMENT_CATEGORIES) }), req.query);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw invalid('Choose a file to upload', { file: 'No file received' });
    const mime = sniffMime(body);
    if (!mime) throw invalid(`Upload a ${Object.values(UPLOAD_TYPES).join(', ')} file`, { file: 'File type not allowed' });
    const id = newId();
    const storageKey = `documents/${new Date().getUTCFullYear()}/${id}`;
    await app.storage.put(storageKey, body);
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('documents')
          .values({
            id,
            owner_user_id: req.actor!.userId,
            programme_id: p.id,
            category: meta.category,
            kind: 'other',
            title: meta.title,
            storage_key: storageKey,
            original_name: safeFileName(meta.fileName),
            mime_type: mime,
            size_bytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
            uploaded_by: req.actor!.userId,
          })
          .execute();
        await audit(trx, auditCtx(req), { action: 'programme.document_uploaded', entityType: 'programme', entityId: p.id, after: { documentId: id, title: meta.title, category: meta.category } });
      });
    } catch (e) {
      await app.storage.delete(storageKey);
      throw e;
    }
    reply.code(201);
    return { id };
  });

  app.get('/programmes/:id/documents/:docId/link', { config: { permission: 'programme.read' } }, async (req) => {
    const { id, docId } = parse(z.object({ id: uuidSchema, docId: uuidSchema }), req.params);
    const p = await visible(req, id);
    const d = await db.selectFrom('documents').select(['id', 'title']).where('id', '=', docId).where('programme_id', '=', p.id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!d) throw notFound('Document');
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'programme', entityId: p.id, after: { documentId: d.id, title: d.title } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresInSeconds: LINK_TTL_SECONDS };
  });

  // ---------------------------------------------------------------- manage (AD-10, VTA staff only)

  const validateLinks = async (b: z.output<typeof programmeSchema>) => {
    const fields: Record<string, string> = {};
    const partners = await db.selectFrom('organisations').select(['id', 'type', 'status']).where('id', 'in', b.partnerOrganisationIds).execute();
    if (partners.length !== b.partnerOrganisationIds.length || partners.some((o) => o.type !== 'partner' || o.status !== 'active')) fields.partnerOrganisationIds = 'Choose active training partner organisations';
    if (b.sponsorOrganisationId) {
      const s = await db.selectFrom('organisations').select(['type']).where('id', '=', b.sponsorOrganisationId).executeTakeFirst();
      if (!s || s.type === 'vta') fields.sponsorOrganisationId = 'Choose a sponsor organisation';
    }
    if (b.batchIds.length) {
      const found = await db.selectFrom('batches').select('id').where('id', 'in', b.batchIds).execute();
      if (found.length !== new Set(b.batchIds).size) fields.batchIds = 'One or more batches were not found';
    }
    if (Object.keys(fields).length) throw invalid('Check the programme details', fields);
  };
  const row = (b: z.output<typeof programmeSchema>) => ({
    name: b.name,
    description: b.description ?? null,
    sponsor_organisation_id: b.sponsorOrganisationId ?? null,
    target_count: b.targetCount,
    start_date: b.startDate,
    end_date: b.endDate,
    status: b.status,
    reporting_requirements: b.reportingRequirements ?? null,
    beneficiary_fields: [...new Set(b.beneficiaryFields)],
    sharing_basis: b.sharingBasis ?? null,
    budget_reference: b.budgetReference ?? null,
    budget_amount: b.budgetAmount ?? null,
    budget_source: b.budgetSource ?? null,
    budget_as_of: b.budgetAsOf ?? null,
  });
  const setLinks = async (trx: Kysely<Database>, id: string, b: z.output<typeof programmeSchema>) => {
    const before = new Set((await trx.selectFrom('programme_partners').select('organisation_id').where('programme_id', '=', id).execute()).map((r) => r.organisation_id));
    // SH-07: partners newly added to the programme hear about it.
    for (const org of new Set(b.partnerOrganisationIds)) {
      if (!before.has(org)) await notify(trx, await orgMembers(trx, org, PARTNER_TEAM), 'programme_assigned', { programme: b.name }, `/partner/programmes/${id}`);
    }
    await trx.deleteFrom('programme_partners').where('programme_id', '=', id).execute();
    await trx.insertInto('programme_partners').values([...new Set(b.partnerOrganisationIds)].map((o) => ({ programme_id: id, organisation_id: o }))).execute();
    await trx.deleteFrom('programme_batches').where('programme_id', '=', id).execute();
    if (b.batchIds.length) await trx.insertInto('programme_batches').values([...new Set(b.batchIds)].map((x) => ({ programme_id: id, batch_id: x }))).execute();
  };

  app.post('/admin/programmes', { config: { permission: 'programme.manage' } }, async (req, reply) => {
    const b = parse(programmeSchema, req.body);
    await validateLinks(b);
    const id = newId();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('programmes').values({ id, created_by: req.actor!.userId, ...row(b) }).execute();
      await setLinks(trx, id, b);
      await audit(trx, auditCtx(req), { action: 'programme.created', entityType: 'programme', entityId: id, after: { name: b.name, partners: b.partnerOrganisationIds, batches: b.batchIds, beneficiaryFields: b.beneficiaryFields, sharingBasis: b.sharingBasis ?? null } });
    });
    reply.code(201);
    return { id };
  });

  app.put('/admin/programmes/:id', { config: { permission: 'programme.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(programmeSchema, req.body);
    const before = await db.selectFrom('programmes').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('Programme');
    await validateLinks(b);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('programmes').set({ ...row(b), updated_at: new Date() }).where('id', '=', id).execute();
      await setLinks(trx, id, b);
      await audit(trx, auditCtx(req), {
        action: 'programme.updated',
        entityType: 'programme',
        entityId: id,
        before: { name: before.name, status: before.status, beneficiaryFields: before.beneficiary_fields, sharingBasis: before.sharing_basis },
        after: { name: b.name, status: b.status, partners: b.partnerOrganisationIds, batches: b.batchIds, beneficiaryFields: b.beneficiaryFields, sharingBasis: b.sharingBasis ?? null },
      });
    });
    return dto(req, (await db.selectFrom('programmes').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
};
