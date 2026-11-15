import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActive, isChildActive, visibleNav } from './nav';

describe('primary navigation', () => {
  it('follows the approved order, with no duplicates', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      'Dashboard',
      'Documents',
      'Signature Studio',
      'Templates',
      'Contacts',
      'Team',
      'Billing & Credits',
      'Reports',
      'Integrations',
      'API Docs',
      'Settings',
    ]);
    const hrefs = NAV_ITEMS.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]);
    const parentHrefs = new Set(NAV_ITEMS.map((n) => n.href));
    // A child may repeat its own parent's path (the "All"/"Overview" entry) but nothing else.
    const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i && !parentHrefs.has(h));
    expect(dupes).toEqual([]);
  });

  it('marks only the exact dashboard route active', () => {
    expect(isActive('/app', '/app')).toBe(true);
    expect(isActive('/app/settings', '/app')).toBe(false);
    expect(isActive('/app/settings/profile', '/app/settings')).toBe(true);
    expect(isActive('/app/settingsx', '/app/settings')).toBe(false);
  });

  it('matches submenu links by tab, with the untabbed link standing for the default tab', () => {
    expect(isChildActive('/app/documents', null, '/app/documents')).toBe(true);
    expect(isChildActive('/app/documents', 'all', '/app/documents')).toBe(true);
    expect(isChildActive('/app/documents', 'completed', '/app/documents')).toBe(false);
    expect(isChildActive('/app/documents', 'completed', '/app/documents?tab=completed')).toBe(true);
    expect(isChildActive('/app/documents/abc', null, '/app/documents')).toBe(false);
    expect(isChildActive('/app/billing', 'plans', '/app/billing?tab=plans')).toBe(true);
    expect(isChildActive('/app/billing', 'payments', '/app/billing?tab=payments')).toBe(true);
    expect(isChildActive('/app/billing', 'payments', '/app/billing')).toBe(false);
    expect(isChildActive('/app/billing', null, '/app/billing')).toBe(true);
    expect(isChildActive('/app/settings/profile', null, '/app/settings/profile')).toBe(true);
    expect(isChildActive('/app/settings/profile', null, '/app/settings')).toBe(false);
  });

  it('keeps Design a Signature and My Signatures apart', () => {
    const lib = '/app/signature-studio/library';
    expect(isChildActive(lib, null, '/app/signature-studio')).toBe(false);
    expect(isChildActive(lib, null, lib)).toBe(true);
    expect(isActive(lib, '/app/signature-studio')).toBe(true);
  });

  it('hides what a role cannot use, and never adds anything', () => {
    const viewer = visibleNav([]);
    expect(viewer.map((n) => n.label)).toEqual([
      'Dashboard',
      'Integrations',
      'API Docs',
      'Settings',
    ]);
    expect(viewer.find((n) => n.label === 'Settings')!.children!.map((c) => c.label)).not.toContain(
      'API Settings',
    );
    const dev = visibleNav(['api.manage', 'templates.view', 'documents.view_own']);
    expect(dev.map((n) => n.label)).toEqual(
      expect.arrayContaining(['Templates', 'Documents', 'Reports']),
    );
    expect(dev.map((n) => n.label)).not.toContain('Billing & Credits');
    expect(dev.find((n) => n.label === 'Settings')!.children!.map((c) => c.label)).toContain(
      'API Settings',
    );
  });

  it('shows Signature Studio only while it is switched on', () => {
    expect(visibleNav([]).map((n) => n.label)).not.toContain('Signature Studio');
    expect(visibleNav([], true).map((n) => n.label)).toContain('Signature Studio');
    const owner = visibleNav(
      [
        'documents.view_all',
        'templates.view',
        'contacts.view',
        'team.view',
        'billing.manage',
        'api.manage',
      ],
      true,
    );
    expect(owner).toHaveLength(NAV_ITEMS.length);
  });
});
