import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it('returns to the signed-in API documentation after sign-in', () => {
    expect(safeNextPath('/app/api-docs')).toBe('/app/api-docs');
  });
  it('rejects other app pages, other sites and look-alikes', () => {
    expect(safeNextPath('/app/billing')).toBeNull();
    expect(safeNextPath('//evil.example/app/api-docs')).toBeNull();
    expect(safeNextPath('/app/api-docs/../billing')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
