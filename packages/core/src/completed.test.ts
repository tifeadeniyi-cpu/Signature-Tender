import { describe, expect, it } from 'vitest';
import { createClaimTicket, readClaimTicket } from './completed';

const secret = 'test-secret-0123456789abcdef0123456789';
const ids = {
  requestId: '9ada0de9-068f-49c9-989b-bf72903cf46c',
  recipientId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
};

describe('claim tickets', () => {
  it('round-trips and matches the claim path pattern', () => {
    const t = createClaimTicket(ids, secret);
    expect(readClaimTicket(t, secret)).toMatchObject(ids);
    expect(`/claim/${t}`).toMatch(/^\/claim\/[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/);
  });
  it('rejects a wrong secret, a tampered payload and an expired ticket', () => {
    const t = createClaimTicket(ids, secret);
    expect(readClaimTicket(t, secret + 'x')).toBeNull();
    const [p, mac] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...ids, requestId: '00000000-0000-4000-8000-000000000000', exp: 9e9 }),
    ).toString('base64url');
    expect(readClaimTicket(`${forged}.${mac}`, secret)).toBeNull();
    expect(readClaimTicket(`${p}.${mac}.x`, secret)).toBeNull();
    const old = createClaimTicket(ids, secret, Date.now() - 8 * 86_400_000);
    expect(readClaimTicket(old, secret)).toBeNull();
  });
});
