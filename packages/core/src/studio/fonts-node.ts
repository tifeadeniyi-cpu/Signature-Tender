import { readFile } from 'node:fs/promises';
import path from 'node:path';
import opentype from 'opentype.js';
import { FONT_BY_ID } from './families';
import type { FontLike, FontProvider } from './render';

/**
 * Server font loader for the self-hosted Studio fonts (`<dir>/<id>.woff`). Fonts are parsed once
 * per process and only for ids in the curated catalogue, so a design cannot name a file path.
 */
export function nodeFontLoader(dir: string) {
  const cache = new Map<string, Promise<FontLike | undefined>>();
  const load = (id: string) => {
    if (!(id in FONT_BY_ID)) return Promise.resolve(undefined);
    let p = cache.get(id);
    if (!p) {
      p = readFile(path.join(dir, `${id}.woff`))
        .then((b) => opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as unknown as FontLike)
        .catch((err) => {
          cache.delete(id);
          console.error(`Studio font ${id} failed to load`, err);
          return undefined;
        });
      cache.set(id, p);
    }
    return p;
  };
  return async (ids: string[]): Promise<FontProvider> => {
    const loaded = new Map<string, FontLike>();
    for (const id of ids) {
      const f = await load(id);
      if (f) loaded.set(id, f);
    }
    return { get: (id) => loaded.get(id) };
  };
}
