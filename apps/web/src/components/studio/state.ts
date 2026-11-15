'use client';
import { useCallback, useReducer } from 'react';
import { CANVAS_H, CANVAS_W, type Design, type DesignElement } from '@st/core/studio/index';

/** Undo/redo history over immutable designs. `commit: false` updates without a history step (drags). */
interface History {
  past: Design[];
  present: Design;
  future: Design[];
  original: Design;
  /** The present before the current drag started, so one drag is one undo step. */
  pending: Design | null;
}

type Action =
  | { type: 'set'; design: Design; commit: boolean }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; design: Design }
  | { type: 'load'; design: Design };

const LIMIT = 80;

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'set':
      if (!a.commit) return { ...h, present: a.design, pending: h.pending ?? h.present };
      return {
        ...h,
        past: [...h.past, h.pending ?? h.present].slice(-LIMIT),
        present: a.design,
        future: [],
        pending: null,
      };
    case 'end':
      if (!h.pending) return h;
      return { ...h, past: [...h.past, h.pending].slice(-LIMIT), future: [], pending: null };
    case 'undo': {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      return { ...h, past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], pending: null };
    }
    case 'redo': {
      const [next, ...rest] = h.future;
      if (!next) return h;
      return { ...h, past: [...h.past, h.present], present: next, future: rest, pending: null };
    }
    case 'reset':
      return { ...h, past: [...h.past, h.present].slice(-LIMIT), present: a.design, future: [], pending: null };
    case 'load':
      return { past: [], present: a.design, future: [], original: a.design, pending: null };
  }
}

export function useDesignHistory(initial: Design) {
  const [h, dispatch] = useReducer(reducer, initial, (d) => ({
    past: [],
    present: d,
    future: [],
    original: d,
    pending: null,
  }));
  const set = useCallback(
    (fn: (d: Design) => Design, commit = true) => dispatch({ type: 'set', design: fn(h.present), commit }),
    [h.present],
  );
  return {
    design: h.present,
    original: h.original,
    canUndo: h.past.length > 0 || h.pending !== null,
    canRedo: h.future.length > 0,
    set,
    replace: (design: Design, commit = true) => dispatch({ type: 'set', design, commit }),
    endDrag: () => dispatch({ type: 'end' }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    reset: (design: Design) => dispatch({ type: 'reset', design }),
    load: (design: Design) => dispatch({ type: 'load', design }),
  };
}
export type DesignHistory = ReturnType<typeof useDesignHistory>;

export function newId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
}

export function updateElement(d: Design, id: string, patch: Partial<DesignElement>): Design {
  return { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Maps a point in design space back into an element's own (local) coordinates. */
export function toLocal(e: DesignElement, x: number, y: number): [number, number] {
  let dx = (x - e.x) / e.scale;
  let dy = (y - e.y) / e.scale;
  const r = (-e.rotate * Math.PI) / 180;
  [dx, dy] = [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
  if (e.flipX) dx = -dx;
  if (e.flipY) dy = -dy;
  return [dx, dy];
}

/** Local element coordinates to design space (same order as the core renderer's transform). */
export function toDesign(e: DesignElement, lx: number, ly: number): [number, number] {
  let x = e.flipX ? -lx : lx;
  let y = e.flipY ? -ly : ly;
  x *= e.scale;
  y *= e.scale;
  const r = (e.rotate * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r) + e.x, x * Math.sin(r) + y * Math.cos(r) + e.y];
}

/** Inverse of the drawing-layer transform, so new strokes land under the pointer. */
export function toDrawingSpace(d: Design, x: number, y: number): [number, number] {
  const ox = CANVAS_W / 2;
  const oy = CANVAS_H / 2;
  const t = d.drawing;
  let dx = x - ox - t.x;
  let dy = y - oy - t.y;
  const r = (-t.rotate * Math.PI) / 180;
  [dx, dy] = [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
  return [dx / t.scale + ox, dy / t.scale + oy];
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
