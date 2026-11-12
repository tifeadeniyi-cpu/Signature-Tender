import { describe, it, expect } from 'vitest';
import { findUnrecorded } from '@st/db/migrate';

describe('skipped migration guard', () => {
  const journal = [
    { folderMillis: 100, hash: 'a' },
    { folderMillis: 200, hash: 'b' },
    { folderMillis: 300, hash: 'c' },
  ];

  it('passes when every migration is recorded by timestamp or hash', () => {
    expect(
      findUnrecorded(journal, [
        { created_at: '100', hash: 'a' },
        { created_at: 150, hash: 'edited-later' },
        { created_at: '999', hash: 'b' },
        { created_at: '300', hash: 'changed' },
      ]),
    ).toEqual([]);
  });

  it('reports migrations skipped because another branch recorded a newer one', () => {
    expect(
      findUnrecorded(journal, [
        { created_at: '100', hash: 'a' },
        { created_at: '250', hash: 'other-branch' },
        { created_at: '300', hash: 'c' },
      ]),
    ).toEqual([200]);
  });
});
