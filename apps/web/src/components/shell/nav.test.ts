import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActive, isChildActive, visibleNav } from './nav';

describe('primary navigation', () => {
  it('follows the approved order, with no duplicates', () => {
    const labels = NAV_ITEMS.map((n) => n.label);
    expect(labels).toEqual([
      'Dashboard',
      'Documents',
      'Templates',
      'Contacts',
      'Team',
      'Billing & Credits',
      'Integrations',
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
    expect(isChildActive('/app/billing', null, '/app/billing')).toBe(true);
    expect(isChildActive('/app/settings/profile', null, '/app/settings/profile')).toBe(true);
    expect(isChildActive('/app/settings/profile', null, '/app/settings')).toBe(false);
  });

  it('hides what a role cannot use, and never adds anything', () => {
    const viewer = visibleNav([]);
    expect(viewer.map((n) => n.label)).toEqual([
      'Dashboard',
      'Documents',
      'Billing & Credits',
      'Integrations',
      'Settings',
    ]);
    expect(viewer.find((n) => n.label === 'Settings')!.children!.map((c) => c.label)).not.toContain(
      'API Settings',
    );
    const dev = visibleNav(['api.manage', 'templates.view']);
    expect(dev.map((n) => n.label)).toContain('Templates');
    expect(dev.find((n) => n.label === 'Settings')!.children!.map((c) => c.label)).toContain(
      'API Settings',
    );
    const owner = visibleNav(['templates.view', 'contacts.view', 'team.view', 'api.manage']);
    expect(owner).toHaveLength(NAV_ITEMS.length);
  });
});
