'use client';
import { useEffect, useMemo, useState } from 'react';
import { FONT_BY_ID, type FontLike, type FontProvider } from '@st/core/studio/index';

/**
 * Browser font loading for Signature Studio. Faces are self-hosted and fetched only when used:
 * outlines (opentype.js) for the live renderer, and CSS FontFace for gallery previews.
 */
const outlines = new Map<string, Promise<FontLike | undefined>>();
const parsed = new Map<string, FontLike>();

export function loadOutline(id: string): Promise<FontLike | undefined> {
  if (!(id in FONT_BY_ID)) return Promise.resolve(undefined);
  let p = outlines.get(id);
  if (!p) {
    p = (async () => {
      const [{ default: opentype }, res] = await Promise.all([
        import('opentype.js'),
        fetch(`/studio-fonts/${id}.woff`),
      ]);
      if (!res.ok) throw new Error(`font ${id}: ${res.status}`);
      const font = opentype.parse(await res.arrayBuffer()) as unknown as FontLike;
      parsed.set(id, font);
      return font;
    })().catch(() => {
      outlines.delete(id);
      return undefined;
    });
    outlines.set(id, p);
  }
  return p;
}

/** A font provider over everything loaded so far; `ready` changes when a requested face arrives. */
export function useOutlines(ids: string[]): { fonts: FontProvider; ready: number } {
  const key = [...new Set(ids)].sort().join(',');
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    for (const id of key.split(',').filter(Boolean))
      if (!parsed.has(id)) void loadOutline(id).then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, [key]);
  const fonts = useMemo<FontProvider>(() => ({ get: (id) => parsed.get(id) }), []);
  return { fonts, ready };
}

const faces = new Map<string, Promise<boolean>>();

/** CSS family name for gallery previews. Loads the face once, the first time it is needed. */
export function cssFamily(id: string) {
  return `st-studio-${id}`;
}

export function loadFace(id: string): Promise<boolean> {
  if (!(id in FONT_BY_ID) || typeof FontFace === 'undefined') return Promise.resolve(false);
  let p = faces.get(id);
  if (!p) {
    const face = new FontFace(cssFamily(id), `url(/studio-fonts/${id}.woff) format('woff')`, { display: 'swap' });
    p = face
      .load()
      .then((f) => {
        document.fonts.add(f);
        return true;
      })
      .catch(() => false);
    faces.set(id, p);
  }
  return p;
}

/** Loads a face when its card scrolls into view (lazy font loading for the gallery). */
export function useLazyFace(id: string) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void loadFace(id).then(setLoaded);
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, id]);
  return { ref: setEl, loaded };
}
