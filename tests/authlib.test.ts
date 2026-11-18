import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../src/server/auth/passwords.js';
import { base32Decode, base32Encode, totpCode, totpUri, verifyTotp } from '../src/server/auth/totp.js';

describe('passwords', () => {
  it('verifies the right password only', () => {
    const hash = hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery', hash)).toBe(true);
    expect(verifyPassword('wrong horse battery', hash)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
  it('explains weak passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('owner@x.example', 'owner@x.example')).toMatch(/same as the e-mail/);
    expect(passwordProblem('long enough pass')).toBeNull();
  });
});

describe('totp', () => {
  // RFC 6238 test secret "12345678901234567890" (SHA-1).
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('round-trips base32', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('matches the RFC 6238 test vectors', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('accepts a step either side and refuses reuse', () => {
    const at = new Date(1234567890 * 1000);
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(secret, totpCode(secret, step - 1), at)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 2), at)).toBeNull();
    expect(verifyTotp(secret, '005 924', at)).toBe(step);
    expect(verifyTotp(secret, '005924', at, step)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', at)).toBeNull();
  });
  it('builds an authenticator link', () => {
    expect(totpUri('ABC', 'a@b.example')).toBe('otpauth://totp/Lgbids%3Aa%40b.example?secret=ABC&issuer=Lgbids&algorithm=SHA1&digits=6&period=30');
  });
});
