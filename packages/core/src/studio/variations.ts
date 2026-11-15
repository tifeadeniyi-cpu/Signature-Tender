import type { Design, DesignElement } from './design';
import { newElement } from './design';
import { FONT_BY_ID, type ElementType, type TextParams } from './families';

/**
 * "Generate Variations": distinct, editable treatments of the current typed signature in its
 * selected font. Fully deterministic: round n always yields the same set, so nothing changes
 * unexpectedly and a chosen variation stays stable.
 */
interface Treatment {
  label: string;
  params: Partial<TextParams>;
  underline?: ElementType;
  flourish?: ElementType;
}

const TREATMENTS: Treatment[] = [
  { label: 'Upright & clean', params: { slant: 0, connect: 0.2, baseline: 1, entry: false, tail: false } },
  { label: 'Confident lean', params: { slant: 10, capitals: 1.3, tail: true, curve: 55 } },
  { label: 'Grand capital', params: { capitals: 1.6, entry: true, loop: 55, descenders: 0.3 } },
  { label: 'Quick & tight', params: { slant: 6, connect: 0.7, spacing: -0.05, baseline: 4 }, underline: 'u-straight' },
  { label: 'Airy', params: { spacing: 0.15, lower: 0.9, baseline: 2 }, underline: 'u-thin-curve' },
  { label: 'Sweeping finish', params: { tail: true, loop: 70, curve: 75 }, underline: 'u-long-sweep' },
  { label: 'Executive', params: { slant: 4, capitals: 1.4, width: 1.15 }, underline: 'u-sharp-end' },
  { label: 'Looped', params: { entry: true, loop: 80 }, underline: 'u-looping' },
  { label: 'Wandering baseline', params: { baseline: 8, slant: 3 }, flourish: 'f-curved-tail' },
  { label: 'Long descenders', params: { descenders: 0.9, slant: 5 } },
  { label: 'Compact', params: { width: 0.85, height: 1.1, connect: 0.5 }, underline: 'u-double' },
  { label: 'Flourished', params: { capitals: 1.35, tail: true }, flourish: 'f-swoosh' },
];

export function generateVariations(d: Design, round = 0, count = 6): { label: string; design: Design }[] {
  if (!d.text?.value.trim()) return [];
  const font = FONT_BY_ID[d.text.font];
  const out: { label: string; design: Design }[] = [];
  for (let i = 0; i < count; i++) {
    const t = TREATMENTS[(round * count + i) % TREATMENTS.length]!;
    const params = { ...d.text.params, ...t.params };
    // Offer real alternate letterforms on alternating variations, only if the face has them.
    if (font?.init) params.initForms = i % 2 === 0;
    if (font?.fina) params.finaForms = i % 2 === 1;
    const elements: DesignElement[] = d.elements.filter((e) => e.type === 'freehand');
    if (t.underline) elements.push(newElement(t.underline, `v${round}${i}u`.padEnd(4, '0'), { x: 600, y: 300, scale: 0.85 }));
    if (t.flourish) elements.push(newElement(t.flourish, `v${round}${i}f`.padEnd(4, '0'), { x: 760, y: 280, scale: 0.6 }));
    out.push({
      label: t.label,
      design: { ...d, method: d.method === 'draw' || d.method === 'upload' ? 'type' : d.method, text: { ...d.text, params }, elements },
    });
  }
  return out;
}
