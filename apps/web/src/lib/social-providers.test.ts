import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';

vi.mock('server-only', () => ({}));
vi.mock('./env', () => ({ env: () => ({}) }));

const { appleClientSecret } = await import('./social-providers');

describe('appleClientSecret', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('builds an ES256 JWT Apple accepts', () => {
    const jwt = appleClientSecret({
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      clientId: 'com.signaturetender.web',
      privateKey: pem.replace(/\n/g, '\\n'), // pasted with literal \n
      now: 1_700_000_000_000,
    });
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEY1234567',
      typ: 'JWT',
    });
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(payload).toMatchObject({
      iss: 'TEAM123456',
      sub: 'com.signaturetender.web',
      aud: 'https://appleid.apple.com',
      iat: 1_700_000_000,
    });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(15_777_000); // Apple's 6-month cap
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s!, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});
