import { describe, it, expect } from 'vitest';
import { compare, parseRange } from './range';

const NOW = new Date('2026-11-12T18:00:00Z');

describe('dashboard range', () => {
  it('defaults to the last 30 days, inclusive of today', () => {
    const r = parseRange({}, 'America/Chicago', NOW);
    expect(r).toMatchObject({ key: '30d', from: '2026-10-14', to: '2026-11-12' });
  });
  it('uses the member time zone for today', () => {
    // 01:30 UTC on the 13th is still the 12th in Chicago.
    const r = parseRange({ range: '7d' }, 'America/Chicago', new Date('2026-11-13T01:30:00Z'));
    expect(r.to).toBe('2026-11-12');
    expect(r.from).toBe('2026-11-06');
  });
  it('accepts a custom range, clamps the future and swaps reversed dates', () => {
    const r = parseRange({ range: 'custom', from: '2026-12-01', to: '2026-11-01' }, 'UTC', NOW);
    expect(r).toMatchObject({ key: 'custom', from: '2026-11-01', to: '2026-11-12' });
  });
  it('ignores a malformed custom range', () => {
    expect(parseRange({ range: 'custom', from: 'x', to: 'y' }, 'UTC', NOW).key).toBe('30d');
  });
  it('starts This Year on January 1', () => {
    expect(parseRange({ range: 'year' }, 'UTC', NOW).from).toBe('2026-01-01');
  });
});

describe('period comparison', () => {
  it('never divides by zero', () => {
    expect(compare(0, 0)).toEqual({ text: 'No change', tone: 'flat' });
    expect(compare(3, 0)).toEqual({ text: 'New', tone: 'up' });
  });
  it('rounds percentages and signs them', () => {
    expect(compare(4, 3)).toEqual({ text: '+33%', tone: 'up' });
    expect(compare(1, 4)).toEqual({ text: '-75%', tone: 'down' });
  });
});
