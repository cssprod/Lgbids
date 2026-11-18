import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Account passwords are stored as scrypt hashes: slow to guess, and the
 * parameters travel with the hash so they can be raised later.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length === 0) return false;
  const key = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** A sentence saying what is wrong with a new password, or null when it is acceptable. */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Please use at least ${MIN_PASSWORD_LENGTH} characters for the password.`;
  if (password.length > 200) return 'Please use a password of at most 200 characters.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'The password must not be the same as the e-mail address.';
  return null;
}
