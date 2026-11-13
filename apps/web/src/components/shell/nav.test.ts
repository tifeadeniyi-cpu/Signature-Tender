import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActive, visibleNav } from './nav';

describe('primary navigation', () => {
  it('follows the dashboard spec order and keeps Team, Billing and Integrations', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      'Dashboard',
      'Documents',
      'Signature Studio',
      'My Signatures',
      'Templates',
      'Contacts',
      'Team',
      'Transactions',
      'Billing & Credits',
      'Reports',
      'Integrations',
      'Settings',
    ]);
  });
  it('marks only the exact dashboard route active', () => {
    expect(isActive('/app', '/app')).toBe(true);
    expect(isActive('/app/settings', '/app')).toBe(false);
    expect(isActive('/app/settings/profile', '/app/settings')).toBe(true);
    expect(isActive('/app/settingsx', '/app/settings')).toBe(false);
  });
  it('does not highlight Signature Studio on My Signatures', () => {
    const studio = NAV_ITEMS.find((n) => n.label === 'Signature Studio')!;
    const lib = NAV_ITEMS.find((n) => n.label === 'My Signatures')!;
    expect(isActive('/app/signature-studio/library', studio.href, studio)).toBe(false);
    expect(isActive('/app/signature-studio/library', lib.href, lib)).toBe(true);
    expect(isActive('/app/signature-studio', studio.href, studio)).toBe(true);
  });
  it('tells Transactions and Billing apart by the tab', () => {
    const tx = NAV_ITEMS.find((n) => n.label === 'Transactions')!;
    const bill = NAV_ITEMS.find((n) => n.label === 'Billing & Credits')!;
    const pay = new URLSearchParams('tab=payments');
    const none = new URLSearchParams('');
    expect(isActive('/app/billing', tx.href, tx, pay)).toBe(true);
    expect(isActive('/app/billing', bill.href, bill, pay)).toBe(false);
    expect(isActive('/app/billing', bill.href, bill, none)).toBe(true);
    expect(isActive('/app/billing', tx.href, tx, none)).toBe(false);
  });
  it('hides items the member has no permission for, and studio items when it is off', () => {
    const labels = visibleNav(['documents.view_own'], false).map((n) => n.label);
    expect(labels).toEqual(['Dashboard', 'Documents', 'Reports', 'Integrations', 'Settings']);
    expect(visibleNav([], true).map((n) => n.label)).toContain('My Signatures');
    expect(visibleNav(['billing.manage'], false).map((n) => n.label)).toContain('Transactions');
  });
});
