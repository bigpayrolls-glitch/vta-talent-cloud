import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { v7 } from 'uuid';

export const newId = (): string => v7();

/** 256-bit random token, URL-safe. Used for sessions, CSRF and invitation links. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Tokens are stored as SHA-256 hashes so a database leak does not leak live sessions. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hashPassword = (password: string): Promise<string> => hash(password); // Argon2id defaults

export const verifyPassword = async (passwordHash: string, password: string): Promise<boolean> => {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
};

/** A real hash used to keep login timing the same when the email is unknown. */
let dummyHash: string | undefined;
export const dummyPasswordCheck = async (password: string): Promise<void> => {
  dummyHash ??= await hash('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
};

export const sixDigitCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** Small list of the most common passwords (SEC-07). Extend with a full list before production. */
const COMMON_PASSWORDS = new Set([
  'password123', '1234567890', '12345678910', 'qwertyuiop', 'password12', 'iloveyou12',
  'admin12345', 'welcome123', 'qwerty1234', 'abcd123456', 'india12345', 'password@123',
  'passw0rd123', '1q2w3e4r5t', 'letmein123', 'changeme123',
]);
export const isCommonPassword = (password: string): boolean => COMMON_PASSWORDS.has(password.toLowerCase());
