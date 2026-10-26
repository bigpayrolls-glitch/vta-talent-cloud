import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv.js';
import { safeFileName, signLink, sniffMime, verifyLink } from '../src/lib/storage.js';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

let ctx: Ctx;
let ops: Client;
beforeAll(async () => {
  ctx = await setup();
  ops = await loginEmail(ctx, EMAIL.opsAdmin);
});
afterAll(() => ctx.close());

const uploadUrl = (id: string, q = 'kind=certificate&title=ITI%20certificate&fileName=iti.pdf') => `/admin/candidates/${id}/documents?${q}`;
const content = (url: string) => ctx.app.inject({ method: 'GET', url });

describe('T-06 private file upload', () => {
  let docId: string;

  it('stores a PDF privately and records it on the candidate', async () => {
    const res = await ops.upload(uploadUrl(ctx.ids.cand1!), PDF);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mimeType: 'application/pdf', sizeBytes: PDF.length, scanStatus: 'not_scanned' });
    docId = res.body.id;
    const c = await ops.get(`/admin/candidates/${ctx.ids.cand1}`);
    expect(c.body.documents[0]).toMatchObject({ id: docId, title: 'ITI certificate', kind: 'certificate', fileName: 'iti.pdf' });
  });

  it('checks the real file type, not the name or the header the browser sent', async () => {
    const exe = await ops.upload(uploadUrl(ctx.ids.cand1!, 'kind=other&title=Sneaky&fileName=photo.pdf'), EXE, 'application/pdf');
    expect(exe.status).toBe(400);
    expect(exe.body.error.fields.file).toBe('File type not allowed');
    const png = await ops.upload(uploadUrl(ctx.ids.cand1!, 'kind=photo&title=Photo&fileName=me.png'), PNG);
    expect(png.body.mimeType).toBe('image/png');
  });

  it('refuses files over 10 MB and empty files', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    expect((await ops.upload(uploadUrl(ctx.ids.cand1!), big)).status).toBe(413);
    expect((await ops.upload(uploadUrl(ctx.ids.cand1!), Buffer.alloc(0))).status).toBe(400);
  });

  it('there is no direct URL: the content route refuses requests without a valid signature', async () => {
    expect((await content(`/api/v1/files/${docId}/content`)).statusCode).toBe(400);
    expect((await content(`/api/v1/files/${docId}/content?exp=9999999999&sig=forged-signature-value`)).statusCode).toBe(403);
  });

  it('an authorised user gets a 5-minute signed link that downloads the exact file', async () => {
    const link = await ops.get(`/files/${docId}/link`);
    expect(link.status).toBe(200);
    expect(link.body.expiresInSeconds).toBe(300);
    const res = await content(link.body.url);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="iti.pdf"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.rawPayload.equals(PDF)).toBe(true);
    const audited = await ctx.db.selectFrom('audit_events').select('action').where('action', '=', 'document.link_created').execute();
    expect(audited.length).toBeGreaterThan(0);
  });

  it('a link cannot be reused for another document or after it expires', async () => {
    const link = await ops.get(`/files/${docId}/link`);
    const other = await ops.upload(uploadUrl(ctx.ids.cand2!), PDF);
    const swapped = link.body.url.replace(docId, other.body.id);
    expect((await content(swapped)).statusCode).toBe(403);
    const secret = ctx.app.config.fileSigningSecret;
    const old = signLink(secret, docId, Date.now() - 10 * 60_000);
    const res = await content(`/api/v1/files/${docId}/content?exp=${old.exp}&sig=${old.sig}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/expired/);
  });

  it('only admins can upload; centre admins only see documents of candidates at their centres', async () => {
    const centre = await loginEmail(ctx, EMAIL.centreAdmin);
    expect((await centre.upload(uploadUrl(ctx.ids.cand4!), PDF)).status).toBe(403);
    // cand1 is enrolled at a partner centre, not the centre admin's VTA centre
    expect((await centre.get(`/files/${docId}/link`)).status).toBe(404);
    // cand4 is enrolled at the VTA centre
    const own = await ops.upload(uploadUrl(ctx.ids.cand4!), PDF);
    expect((await centre.get(`/files/${own.body.id}/link`)).status).toBe(200);
    for (const email of [EMAIL.partnerAdminA, EMAIL.employerAdminA]) {
      const c = await loginEmail(ctx, email);
      expect((await c.get(`/files/${docId}/link`)).status, email).toBe(403);
    }
  });

  it('signatures never appear in request logs', async () => {
    const { LOG_SERIALIZERS } = await import('../src/app.js');
    const out = LOG_SERIALIZERS.req({ method: 'GET', url: '/api/v1/files/x/content?exp=1&sig=SECRET123', id: 'r' });
    expect(out.url).toBe('/api/v1/files/x/content?exp=1&sig=[redacted]');
  });
});

describe('helpers', () => {
  it('signs and verifies links', () => {
    const { exp, sig } = signLink('s'.repeat(32), 'doc');
    expect(verifyLink('s'.repeat(32), 'doc', exp, sig)).toBe('ok');
    expect(verifyLink('t'.repeat(32), 'doc', exp, sig)).toBe('invalid');
    expect(verifyLink('s'.repeat(32), 'doc', exp + 1, sig)).toBe('invalid');
  });

  it('recognises PDF, PNG and JPEG only', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('<html>'))).toBeNull();
  });

  it('cleans file names for downloads', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('certificate "final".pdf')).toBe('certificate _final_.pdf');
  });

  it('parses CSV with quotes, commas, escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['last', ''],
    ]);
  });
});
