import { DOCUMENT_KINDS, documentReviewSchema, UPLOAD_MAX_BYTES, UPLOAD_TYPES, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { ApiError, invalid, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { LINK_TTL_SECONDS, safeFileName, signLink, sniffMime, verifyLink } from '../../lib/storage.js';
import { candidateReadScope, inScope } from '../../policy/index.js';

const idParam = z.object({ id: uuidSchema });
const uploadQuery = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().min(2, 'Give the document a title').max(120),
  fileName: z.string().trim().min(1).max(200),
});

/**
 * T-06 / SH-06: private documents.
 * - Upload: the raw file is the request body. Type is checked from the file's first bytes; size is capped.
 * - Download: an authorised user asks for a link; the API returns a signed URL valid for 5 minutes.
 *   The content route checks the signature, never the session, so links work in a new tab but
 *   cannot be guessed or reused later.
 */
export const fileRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const secret = app.config.fileSigningSecret;

  app.post(
    '/admin/candidates/:id/documents',
    { config: { permission: 'document.upload' }, bodyLimit: UPLOAD_MAX_BYTES },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const meta = parse(uploadQuery, req.query);
      const owner = await db.selectFrom('candidate_profiles').select('user_id').where('user_id', '=', id).executeTakeFirst();
      if (!owner) throw notFound('Candidate');
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw invalid('Choose a file to upload', { file: 'No file received' });
      const mime = sniffMime(body);
      if (!mime) throw invalid(`Upload a ${Object.values(UPLOAD_TYPES).join(', ')} file`, { file: 'File type not allowed' });

      const docId = newId();
      const year = new Date().getUTCFullYear();
      const storageKey = `documents/${year}/${docId}`;
      await app.storage.put(storageKey, body);
      const row = {
        id: docId,
        owner_user_id: id,
        kind: meta.kind,
        title: meta.title,
        storage_key: storageKey,
        original_name: safeFileName(meta.fileName),
        mime_type: mime,
        size_bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        uploaded_by: req.actor!.userId,
      };
      try {
        await db.transaction().execute(async (trx) => {
          await trx.insertInto('documents').values(row).execute();
          await audit(trx, auditCtx(req), {
            action: 'document.uploaded',
            entityType: 'user',
            entityId: id,
            after: { documentId: docId, kind: row.kind, title: row.title, mime_type: mime, size_bytes: row.size_bytes },
          });
        });
      } catch (e) {
        await app.storage.delete(storageKey); // never leave an orphan file behind
        throw e;
      }
      reply.code(201);
      return { id: docId, mimeType: mime, sizeBytes: body.length, scanStatus: 'not_scanned' };
    },
  );

  /**
   * AD-05: VTA verifies or rejects one of a candidate's documents. A verified document can no longer be
   * deleted by the learner; a rejected one tells the learner why, so they can upload a better copy.
   */
  app.post('/admin/candidates/:id/documents/:docId/review', { config: { permission: 'candidate.manage' } }, async (req) => {
    const { id, docId } = parse(z.object({ id: uuidSchema, docId: uuidSchema }), req.params);
    const b = parse(documentReviewSchema, req.body);
    const d = await db
      .selectFrom('documents')
      .select(['id', 'title', 'verification_status'])
      .where('id', '=', docId)
      .where('owner_user_id', '=', id)
      .where('organisation_id', 'is', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!d) throw notFound('Document');
    if (d.verification_status === b.decision) throw invalid(`This document is already ${b.decision}.`);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('documents')
        .set({ verification_status: b.decision, reviewed_by: req.actor!.userId, reviewed_at: new Date(), review_reason: b.decision === 'rejected' ? b.reason! : null })
        .where('id', '=', docId)
        .execute();
      await audit(trx, auditCtx(req), { action: `document.${b.decision}`, entityType: 'user', entityId: id, before: { documentId: docId, verification_status: d.verification_status }, after: { verification_status: b.decision, reason: b.reason ?? null } });
      if (b.decision === 'rejected') await notify(trx, [id], 'document_rejected', { title: d.title, reason: b.reason }, '/learn/documents');
    });
    return { id: docId, verificationStatus: b.decision };
  });

  /** Signed link for an authorised viewer. Every link handed out is recorded. */
  app.get('/files/:id/link', { config: { permission: 'document.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const doc = await db.selectFrom('documents').select(['id', 'owner_user_id', 'title']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!doc || !inScope(await candidateReadScope(db, req.actor!), doc.owner_user_id)) throw notFound('Document');
    const { exp, sig } = signLink(secret, doc.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'user', entityId: doc.owner_user_id, after: { documentId: doc.id, title: doc.title } });
    return { url: `/api/v1/files/${doc.id}/content?exp=${exp}&sig=${sig}`, expiresAt: iso(new Date(exp * 1000)), expiresInSeconds: LINK_TTL_SECONDS };
  });

  app.get('/files/:id/content', { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { exp, sig } = parse(z.object({ exp: z.coerce.number().int(), sig: z.string().min(10).max(100) }), req.query);
    const check = verifyLink(secret, id, exp, sig);
    if (check === 'invalid') throw new ApiError('FORBIDDEN', 'This link is not valid.');
    if (check === 'expired') throw new ApiError('FORBIDDEN', 'This link has expired. Open the document again to get a new link.');
    const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!doc) throw notFound('Document');
    const data = await app.storage.get(doc.storage_key);
    const ext = doc.mime_type === 'application/pdf' ? '.pdf' : doc.mime_type === 'image/png' ? '.png' : '.jpg';
    const name = doc.original_name.toLowerCase().endsWith(ext) ? doc.original_name : `${doc.original_name}${ext}`;
    return reply
      .header('content-type', doc.mime_type)
      .header('content-length', data.length)
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .send(data);
  });
};
