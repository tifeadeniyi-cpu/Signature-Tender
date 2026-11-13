import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActive } from './nav';

describe('primary navigation', () => {
  it('matches the spec order', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      'Dashboard',
      'Documents',
      'Templates',
      'Signature Studio',
      'Contacts',
      'Team',
      'Billing & Credits',
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
});
