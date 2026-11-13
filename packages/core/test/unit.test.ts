import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  permissionsForSystemRole,
  isPermissionKey,
  slugify,
  formatMoney,
  bundleSavingsPercent,
  ACTION_RE,
  profileUpdateSchema,
  workspaceUpdateSchema,
} from '../src';

describe('permissions', () => {
  it('owner has every permission, signer has none', () => {
    expect(permissionsForSystemRole('owner')).toContain('billing.manage');
    expect(permissionsForSystemRole('signer')).toHaveLength(0);
  });
  it('editor can create but not send', () => {
    const p = permissionsForSystemRole('editor');
    expect(hasPermission(p, 'documents.create')).toBe(true);
    expect(hasPermission(p, 'documents.send')).toBe(false);
  });
  it('validates permission keys', () => {
    expect(isPermissionKey('documents.send')).toBe(true);
    expect(isPermissionKey('documents.hack')).toBe(false);
  });
});

describe('helpers', () => {
  it('slugifies names safely', () => {
    expect(slugify('Lara’s Studio & Co.')).toBe('lara-s-studio-co');
    expect(slugify('***')).toBe('workspace');
  });
  it('formats money from cents', () => {
    expect(formatMoney(299)).toBe('$2.99');
    expect(formatMoney(14999)).toBe('$149.99');
  });
  it('computes bundle savings from configured prices', () => {
    const single = { amountCents: 299, credits: 1 };
    expect(bundleSavingsPercent(single, { amountCents: 1299, credits: 5 })).toBe(13);
    expect(bundleSavingsPercent(single, { amountCents: 14999, credits: 100 })).toBe(49);
    expect(bundleSavingsPercent(single, { amountCents: 2000, credits: 5 })).toBe(0);
  });
  it('enforces audit action naming', () => {
    expect(ACTION_RE.test('workspace.created')).toBe(true);
    expect(ACTION_RE.test('DROP TABLE')).toBe(false);
  });
});

describe('validation', () => {
  it('rejects invalid profile input', () => {
    expect(profileUpdateSchema.safeParse({ name: '', timezone: 'America/Chicago' }).success).toBe(
      false,
    );
    expect(profileUpdateSchema.safeParse({ name: 'A', timezone: 'Mars/Base' }).success).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ name: 'A', timezone: 'America/Chicago', phone: '<script>' })
        .success,
    ).toBe(false);
  });
  it('rejects non-http websites', () => {
    expect(
      workspaceUpdateSchema.safeParse({ name: 'X', website: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      workspaceUpdateSchema.safeParse({ name: 'X', website: 'https://example.com' }).success,
    ).toBe(true);
  });
});

describe('signer time zone', () => {
  it('prefers the device zone, falls back to the IP zone, and rejects anything else', async () => {
    const { signerTimeZone, ianaZoneOrNull } = await import('../src');
    expect(signerTimeZone('America/Chicago', 'Asia/Tokyo')).toEqual({
      timeZone: 'America/Chicago',
      source: 'device',
    });
    expect(signerTimeZone('', 'Europe/London')).toEqual({
      timeZone: 'Europe/London',
      source: 'ip',
    });
    expect(signerTimeZone('Mars/Olympus', 'nope')).toBeNull();
    expect(signerTimeZone(undefined, undefined)).toBeNull();
    expect(ianaZoneOrNull('<script>')).toBeNull();
    expect(ianaZoneOrNull('x'.repeat(80))).toBeNull();
    expect(ianaZoneOrNull('UTC')).toBe('UTC');
  });
});
