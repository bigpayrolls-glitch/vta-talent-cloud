import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { safeEqual } from './crypto.js';

/**
 * Private file storage behind an interface (plan §3.5).
 * Only a local-disk driver exists for now. An S3-compatible driver is added once hosting is chosen
 * (decision D10); routes and tests do not change when it is.
 * Files are never served from a public folder: the API checks access, then hands out a signed link
 * that expires after 5 minutes.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export function localStorage(rootDir: string): Storage {
  const resolve = (key: string) => {
    if (!/^[\w/-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(rootDir, key);
  };
  return {
    async put(key, data) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, data, { mode: 0o600, flag: 'wx' });
    },
    get: (key) => readFile(resolve(key)),
    delete: (key) => rm(resolve(key), { force: true }),
  };
}

/**
 * Files kept in PostgreSQL (table stored_files). For hosts without a persistent disk, such as a Vercel staging copy.
 * Fine for demo volumes; production should move to object storage (D10).
 */
export function databaseStorage(db: Kysely<Database>): Storage {
  return {
    async put(key, data) {
      await db.insertInto('stored_files').values({ key, data }).execute();
    },
    async get(key) {
      const row = await db.selectFrom('stored_files').select('data').where('key', '=', key).executeTakeFirst();
      if (!row) throw new Error('File not found in storage');
      return row.data;
    },
    async delete(key) {
      await db.deleteFrom('stored_files').where('key', '=', key).execute();
    },
  };
}

export const LINK_TTL_SECONDS = 5 * 60;

/** Signed download links: HMAC-SHA256 over the document id and expiry time. */
export function signLink(secret: string, documentId: string, now = Date.now()): { exp: number; sig: string } {
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  return { exp, sig: hmac(secret, documentId, exp) };
}

export function verifyLink(secret: string, documentId: string, exp: number, sig: string, now = Date.now()): 'ok' | 'expired' | 'invalid' {
  if (!safeEqual(sig, hmac(secret, documentId, exp))) return 'invalid';
  if (exp < Math.floor(now / 1000)) return 'expired';
  return 'ok';
}

const hmac = (secret: string, id: string, exp: number) => createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');

/** Checks the real file type from its first bytes, not the name the browser sent. */
export function sniffMime(data: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Keeps a download file name safe for the Content-Disposition header. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
}
