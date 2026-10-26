import {
  consentChangeSchema,
  CREDENTIAL_TYPE_LABEL,
  learnerProfileSchema,
  learnerUploadQuery,
  NOTICE_VERSION,
  profileCompleteness,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  uuidSchema,
  type LearnerAssessmentState,
} from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { ApiError, invalid, notFound } from '../../lib/errors.js';
import { LINK_TTL_SECONDS, safeFileName, signLink, sniffMime } from '../../lib/storage.js';
import { iso, parse } from '../../lib/validate.js';
import { findPossibleDuplicate } from '../training/candidateService.js';
import { attendanceByCandidate, emptyStats } from '../operations/common.js';
import { consentRequired, consentState, recordConsent } from './service.js';

const idParam = z.object({ id: uuidSchema });
/** Most evidence files one person can keep (keeps storage use predictable). */
const MAX_DOCUMENTS = 20;

/**
 * Phase 5: the Learner portal API. Every route works on the signed-in person's own records only:
 * there is no id of another person to change, so one learner can never reach another's data.
 */
export const learnerRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const me = (req: FastifyRequest) => req.actor!.userId;

  /** SH-05: nothing but the profile and consents until the current notice and terms are accepted. */
  const requireConsent = async (req: FastifyRequest) => {
    if (await consentRequired(db, me(req))) throw new ApiError('FORBIDDEN', 'Accept the privacy notice and terms of use first.');
  };

  const loadProfile = async (userId: string) =>
    db
      .selectFrom('users as u')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .select([
        'u.id',
        'u.name',
        'u.phone',
        'u.email',
        'u.date_of_birth',
        'cp.candidate_code',
        'cp.city',
        'cp.state',
        'cp.preferred_work_area',
        'cp.skill_areas',
        'cp.experience_months',
        'cp.education',
        'cp.languages',
        'cp.availability',
        'cp.searchable',
        'cp.verification_status',
        'cp.verification_reason',
        'cp.source',
      ])
      .where('u.id', '=', userId)
      .executeTakeFirst();

  const profileDto = async (userId: string) => {
    const p = await loadProfile(userId);
    if (!p) throw notFound('Profile');
    const dto = {
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      dateOfBirth: p.date_of_birth,
      candidateCode: p.candidate_code,
      city: p.city,
      state: p.state,
      preferredWorkArea: p.preferred_work_area,
      skillAreas: p.skill_areas,
      experienceMonths: p.experience_months,
      education: p.education,
      languages: p.languages,
      availability: p.availability,
      searchable: p.searchable,
      verificationStatus: p.verification_status,
      // Staff write this reason for the candidate to act on (needs correction / rejected).
      verificationReason: ['needs_correction', 'rejected'].includes(p.verification_status) ? p.verification_reason : null,
      // Name and date of birth are part of what VTA verifies; after a decision only VTA can change them.
      identityLocked: p.verification_status === 'verified' || p.verification_status === 'rejected',
      consentRequired: await consentRequired(db, userId),
    };
    return { ...dto, completeness: profileCompleteness(dto) };
  };

  // ---------------------------------------------------------------- profile (EE-02)

  app.get('/me/profile', { config: { permission: 'learner.self' } }, async (req) => profileDto(me(req)));

  app.patch('/me/profile', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const input = parse(learnerProfileSchema, req.body);
    const userId = me(req);
    const before = await loadProfile(userId);
    if (!before) throw notFound('Profile');

    const nameChange = input.name !== undefined && input.name !== before.name;
    const dobChange = input.dateOfBirth !== undefined && input.dateOfBirth !== before.date_of_birth;
    const locked = before.verification_status === 'verified' || before.verification_status === 'rejected';
    if ((nameChange || dobChange) && locked) {
      const fields: Record<string, string> = {};
      if (nameChange) fields.name = 'Verified by VTA. Ask your training centre to correct it.';
      if (dobChange) fields.dateOfBirth = 'Verified by VTA. Ask your training centre to correct it.';
      throw invalid('Your name and date of birth have been checked by VTA and cannot be changed here.', fields);
    }

    const email = input.email === undefined ? undefined : input.email === '' ? null : input.email.toLowerCase();
    if (email && email !== before.email) {
      const taken = await db.selectFrom('users').select('id').where('email', '=', email).where('id', '!=', userId).executeTakeFirst();
      if (taken) throw invalid('This email is used by another account', { email: 'Already in use' });
    }

    await db.transaction().execute(async (trx) => {
      const userSet: Record<string, unknown> = {};
      if (nameChange) userSet.name = input.name;
      if (dobChange) userSet.date_of_birth = input.dateOfBirth;
      if (email !== undefined && email !== before.email) Object.assign(userSet, { email, email_verified_at: null });
      if (Object.keys(userSet).length) await trx.updateTable('users').set({ ...userSet, updated_at: new Date() }).where('id', '=', userId).execute();

      const profileSet: Record<string, unknown> = {};
      const map = {
        city: 'city',
        state: 'state',
        preferredWorkArea: 'preferred_work_area',
        skillAreas: 'skill_areas',
        experienceMonths: 'experience_months',
        education: 'education',
        languages: 'languages',
        availability: 'availability',
      } as const;
      for (const [k, col] of Object.entries(map)) {
        const v = input[k as keyof typeof map];
        if (v === undefined) continue;
        profileSet[col] = typeof v === 'string' && v === '' && col !== 'city' ? null : v;
      }
      // A correction the candidate makes goes back to VTA for checking; a possible duplicate is looked for again.
      if (nameChange || dobChange) {
        if (before.verification_status === 'needs_correction') Object.assign(profileSet, { verification_status: 'pending', verification_reason: null });
        const dob = (input.dateOfBirth ?? before.date_of_birth)!;
        profileSet.duplicate_of = await findPossibleDuplicate(trx, input.name ?? before.name, dob, userId);
      }
      if (Object.keys(profileSet).length) await trx.updateTable('candidate_profiles').set({ ...profileSet, updated_at: new Date() }).where('user_id', '=', userId).execute();

      const changed = Object.keys({ ...userSet, ...profileSet }).filter((k) => k !== 'email_verified_at');
      if (changed.length) {
        const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null]));
        await audit(trx, auditCtx(req), {
          action: 'candidate.self_updated',
          entityType: 'user',
          entityId: userId,
          before: pick(before as unknown as Record<string, unknown>),
          after: pick({ ...userSet, ...profileSet }),
        });
      }
    });
    return profileDto(userId);
  });

  // ---------------------------------------------------------------- consents (SH-05, EE-10)

  app.get('/me/consents', { config: { permission: 'learner.self' } }, async (req) => {
    const state = await consentState(db, me(req));
    const history = await db
      .selectFrom('consent_events')
      .select(['id', 'purpose', 'granted', 'notice_version', 'source', 'created_at'])
      .where('user_id', '=', me(req))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(50)
      .execute();
    return {
      noticeVersion: NOTICE_VERSION,
      consentRequired: await consentRequired(db, me(req)),
      current: [...state.values()].map((s) => ({ purpose: s.purpose, granted: s.granted, noticeVersion: s.noticeVersion, at: iso(s.at) })),
      history: history.map((h) => ({ id: h.id, purpose: h.purpose, granted: h.granted, noticeVersion: h.notice_version, source: h.source, at: iso(h.created_at) })),
    };
  });

  app.post('/me/consents', { config: { permission: 'learner.self' } }, async (req) => {
    const { purpose, granted, noticeVersion } = parse(consentChangeSchema, req.body);
    const userId = me(req);
    if (purpose === 'privacy_notice' || purpose === 'terms') {
      if (!granted) throw invalid('These cannot be withdrawn here. To stop using VTA Talent Cloud, ask VTA support to close your account.');
      if (noticeVersion !== NOTICE_VERSION) throw invalid('The privacy notice has changed. Reload the page and read it again.');
    } else {
      await requireConsent(req);
    }
    const current = (await consentState(db, userId)).get(purpose);
    const same = current?.granted === granted && (purpose === 'profile_searchable' || current?.noticeVersion === noticeVersion);
    if (!same) {
      await db.transaction().execute(async (trx) => {
        await recordConsent(trx, { userId, purpose, granted, noticeVersion: purpose === 'profile_searchable' ? null : noticeVersion, source: 'self', recordedBy: userId });
        if (purpose === 'profile_searchable') await trx.updateTable('candidate_profiles').set({ searchable: granted, updated_at: new Date() }).where('user_id', '=', userId).execute();
        await audit(trx, auditCtx(req), {
          action: granted ? 'consent.granted' : 'consent.withdrawn',
          entityType: 'user',
          entityId: userId,
          after: { purpose, notice_version: noticeVersion ?? null },
        });
      });
    }
    return { ok: true, changed: !same, consentRequired: await consentRequired(db, userId) };
  });

  // ---------------------------------------------------------------- evidence documents (EE-03)

  const docDto = (d: { id: string; kind: string; title: string; mime_type: string; size_bytes: number; verification_status: string; scan_status: string; visibility: string; uploaded_by: string | null; created_at: Date }, userId: string) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
    verificationStatus: d.verification_status,
    scanStatus: d.scan_status,
    visibility: d.visibility,
    uploadedBySelf: d.uploaded_by === userId,
    // Learners can remove what they uploaded themselves, unless VTA has already verified it.
    canDelete: d.uploaded_by === userId && d.verification_status !== 'verified',
    createdAt: iso(d.created_at),
  });
  const myDoc = async (userId: string, id: string) => {
    const d = await db.selectFrom('documents').selectAll().where('id', '=', id).where('owner_user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!d) throw notFound('Document');
    return d;
  };

  app.get('/me/documents', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const rows = await db.selectFrom('documents').selectAll().where('owner_user_id', '=', me(req)).where('deleted_at', 'is', null).orderBy('created_at', 'desc').execute();
    return { items: rows.map((d) => docDto(d, me(req))), max: MAX_DOCUMENTS };
  });

  app.post('/me/documents', { config: { permission: 'learner.self' }, bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
    await requireConsent(req);
    const userId = me(req);
    const meta = parse(learnerUploadQuery, req.query);
    const { count } = await db.selectFrom('documents').select((eb) => eb.fn.countAll<string>().as('count')).where('owner_user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(count) >= MAX_DOCUMENTS) throw invalid(`You can keep up to ${MAX_DOCUMENTS} documents. Remove one first.`);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw invalid('Choose a file to upload', { file: 'No file received' });
    const mime = sniffMime(body);
    if (!mime) throw invalid(`Upload a ${Object.values(UPLOAD_TYPES).join(', ')} file`, { file: 'File type not allowed' });

    const id = newId();
    const storageKey = `documents/${new Date().getUTCFullYear()}/${id}`;
    await app.storage.put(storageKey, body);
    const row = {
      id,
      owner_user_id: userId,
      kind: meta.kind,
      title: meta.title,
      storage_key: storageKey,
      original_name: safeFileName(meta.fileName),
      mime_type: mime,
      size_bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      uploaded_by: userId,
      visibility: meta.visibility,
    };
    try {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('documents').values(row).execute();
        await audit(trx, auditCtx(req), {
          action: 'document.uploaded',
          entityType: 'user',
          entityId: userId,
          after: { documentId: id, kind: row.kind, title: row.title, mime_type: mime, size_bytes: row.size_bytes, visibility: row.visibility, by: 'self' },
        });
      });
    } catch (e) {
      await app.storage.delete(storageKey);
      throw e;
    }
    reply.code(201);
    return docDto({ ...row, verification_status: 'pending', scan_status: 'not_scanned', created_at: new Date() }, userId);
  });

  app.patch('/me/documents/:id', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const { visibility } = parse(z.object({ visibility: learnerUploadQuery.shape.visibility.removeDefault() }), req.body);
    const d = await myDoc(me(req), id);
    if (d.visibility !== visibility) {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('documents').set({ visibility }).where('id', '=', id).execute();
        await audit(trx, auditCtx(req), { action: 'document.visibility_changed', entityType: 'user', entityId: me(req), before: { documentId: id, visibility: d.visibility }, after: { documentId: id, visibility } });
      });
    }
    return docDto({ ...d, visibility }, me(req));
  });

  app.delete('/me/documents/:id', { config: { permission: 'learner.self' } }, async (req, reply) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const d = await myDoc(me(req), id);
    if (d.uploaded_by !== me(req)) throw new ApiError('FORBIDDEN', 'This document was added by VTA. Ask your training centre to remove it.');
    if (d.verification_status === 'verified') throw new ApiError('FORBIDDEN', 'This document has been verified by VTA and is kept on your record.');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'document.deleted', entityType: 'user', entityId: me(req), before: { documentId: id, title: d.title }, after: { by: 'self' } });
    });
    reply.code(204);
  });

  app.get('/me/documents/:id/link', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const d = await myDoc(me(req), id);
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'user', entityId: me(req), after: { documentId: d.id, title: d.title, by: 'self' } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresAt: iso(new Date(exp * 1000)), expiresInSeconds: LINK_TTL_SECONDS };
  });

  // ---------------------------------------------------------------- learning (EE-04)

  app.get('/me/learning', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const userId = me(req);
    const rows = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select([
        'e.id as enrolment_id',
        'e.status as enrolment_status',
        'b.id as batch_id',
        'b.name as batch_name',
        'b.status as batch_status',
        'b.start_date',
        'b.end_date',
        'c.title as course_title',
        'c.skill_area',
        'c.attendance_threshold_pct',
        'ce.name as centre_name',
        'ce.city as centre_city',
      ])
      .where('e.candidate_id', '=', userId)
      .where('b.status', '!=', 'cancelled')
      .orderBy('b.start_date', 'desc')
      .execute();

    const ids = rows.map((r) => r.enrolment_id);
    const results = ids.length
      ? await db.selectFrom('assessment_results').select(['enrolment_id', 'status', 'outcome']).where('enrolment_id', 'in', ids).execute()
      : [];
    const creds = ids.length
      ? await db.selectFrom('credentials').select(['id', 'enrolment_id']).where('enrolment_id', 'in', ids).where('status', '=', 'active').execute()
      : [];

    const items = [];
    for (const r of rows) {
      const { sessionsHeld, byCandidate } = await attendanceByCandidate(db, r.batch_id);
      const att = byCandidate.get(userId) ?? emptyStats(sessionsHeld);
      const rs = results.filter((x) => x.enrolment_id === r.enrolment_id);
      const released = rs.find((x) => x.status === 'approved');
      const state: LearnerAssessmentState = released ? 'released' : rs.length ? 'in_review' : 'not_assessed';
      items.push({
        enrolmentId: r.enrolment_id,
        enrolmentStatus: r.enrolment_status,
        batch: { id: r.batch_id, name: r.batch_name, status: r.batch_status, startDate: r.start_date, endDate: r.end_date },
        course: { title: r.course_title, skillArea: r.skill_area },
        centre: { name: r.centre_name, city: r.centre_city },
        attendance: { ...att, sessionsHeld, thresholdPct: r.attendance_threshold_pct, belowThreshold: att.pct !== null && att.pct < r.attendance_threshold_pct },
        assessment: { state, outcome: released?.outcome ?? null },
        credentialId: creds.find((c) => c.enrolment_id === r.enrolment_id)?.id ?? null,
      });
    }
    return { items };
  });

  // ---------------------------------------------------------------- released results (EE-05)

  app.get('/me/results/:id', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id: enrolmentId } = parse(idParam, req.params);
    const r = await db
      .selectFrom('assessment_results as ar')
      .innerJoin('enrolments as e', 'e.id', 'ar.enrolment_id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select(['ar.id', 'ar.total_score', 'ar.max_score', 'ar.outcome', 'ar.trainer_comment', 'ar.released_at', 'ar.reviewed_at', 'b.name as batch_name', 'c.id as course_id', 'c.title as course_title', 'c.pass_mark_pct', 'ce.name as centre_name'])
      .where('ar.enrolment_id', '=', enrolmentId)
      .where('e.candidate_id', '=', me(req))
      .where('ar.status', '=', 'approved')
      .executeTakeFirst();
    if (!r) throw notFound('Result');
    const criteria = await db
      .selectFrom('assessment_criteria as ac')
      .leftJoin('assessment_scores as s', (j) => j.onRef('s.criterion_id', '=', 'ac.id').on('s.result_id', '=', r.id))
      .select(['ac.label', 'ac.max_score', 'ac.required', 's.score', 's.outcome', 's.comment'])
      .where('ac.course_id', '=', r.course_id)
      .orderBy('ac.sort_order')
      .execute();
    // Released result and trainer feedback only: who reviewed it and any internal review notes are never sent.
    return {
      enrolmentId,
      course: r.course_title,
      batch: r.batch_name,
      centre: r.centre_name,
      totalScore: r.total_score,
      maxScore: r.max_score,
      pct: r.max_score ? Math.round((r.total_score / r.max_score) * 1000) / 10 : 0,
      passMarkPct: r.pass_mark_pct,
      outcome: r.outcome,
      feedback: r.trainer_comment,
      releasedAt: iso(r.released_at ?? r.reviewed_at),
      criteria: criteria.map((c) => ({ label: c.label, maxScore: c.max_score, required: c.required, score: c.score, outcome: c.outcome ?? 'not_assessed', comment: c.comment })),
    };
  });

  // ---------------------------------------------------------------- credential wallet (EE-06)

  const credDto = (c: { id: string; credential_type: string; course_title: string; holder_name: string; issue_date: string; issuer_name: string; status: string; verification_code: string; superseded_by: string | null }) => ({
    id: c.id,
    type: c.credential_type,
    typeLabel: CREDENTIAL_TYPE_LABEL[c.credential_type as keyof typeof CREDENTIAL_TYPE_LABEL] ?? c.credential_type,
    course: c.course_title,
    holderName: c.holder_name,
    issueDate: c.issue_date,
    issuer: c.issuer_name,
    status: c.status,
    verifyPath: `/verify/${c.verification_code}`,
    replacedBy: c.superseded_by,
  });

  app.get('/me/credentials', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const rows = await db.selectFrom('credentials').selectAll().where('candidate_id', '=', me(req)).orderBy('issue_date', 'desc').orderBy('created_at', 'desc').execute();
    return { items: rows.map(credDto) };
  });

  app.get('/me/credentials/:id', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const c = await db.selectFrom('credentials').selectAll().where('id', '=', id).where('candidate_id', '=', me(req)).executeTakeFirst();
    if (!c) throw notFound('Certificate');
    return credDto(c);
  });
};
