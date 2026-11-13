/**
 * Signature Studio style catalogue. Every family uses two different handwriting typefaces
 * (all SIL Open Font License or Apache 2.0, self-hosted from /studio-fonts), so no two families
 * share a face. Each family offers four variants: two per face, with different pen settings.
 */

export type FontCategory = 'elegant' | 'luxury' | 'modern' | 'artistic' | 'natural';

export const FONT_CATEGORIES: { id: FontCategory; label: string; description: string }[] = [
  { id: 'elegant', label: 'Elegant Signatures', description: 'Thin, flowing and refined.' },
  { id: 'luxury', label: 'Luxury Calligraphy', description: 'Expressive loops and long letterforms.' },
  { id: 'modern', label: 'Modern Handwritten', description: 'Approachable, natural handwriting.' },
  { id: 'artistic', label: 'Expressive & Artistic', description: 'Sweeping, dramatic and decorative.' },
  { id: 'natural', label: 'Natural Penmanship', description: 'Relaxed, everyday handwriting.' },
];

export interface StudioFont {
  /** File stem in /public/studio-fonts. */
  id: string;
  name: string;
  category: FontCategory;
  /** Visual size adjustment so faces read at a similar height (measured from the outlines). */
  scale: number;
  /**
   * Every face is from Google Fonts. The SIL Open Font License 1.1 and Apache 2.0 both allow
   * commercial use, embedding, and converting glyphs to outlines in exported artwork. Licence
   * texts ship in /public/studio-fonts/licenses.
   */
  license: 'OFL-1.1' | 'Apache-2.0';
  /** Lowercase letters join like cursive (false for print-style handwriting). */
  joins: boolean;
  featured: boolean;
  /** The face has real initial-form (init) / final-form (fina) alternate glyphs. */
  init: boolean;
  fina: boolean;
}

/**
 * The curated library: the 50 candidates from the brief plus four faces already used by Signature
 * Tender. Each was checked for file availability, licence, A-Z/a-z and Latin-1 accented coverage
 * (all complete), and which OpenType alternates it really contains (see scripts in the PR).
 */
export const STUDIO_FONTS: StudioFont[] = [
  { id: 'great-vibes', name: 'Great Vibes', category: 'elegant', scale: 0.88, license: 'OFL-1.1', joins: true, featured: true, init: true, fina: true },
  { id: 'allura', name: 'Allura', category: 'elegant', scale: 1.04, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'alex-brush', name: 'Alex Brush', category: 'elegant', scale: 1.01, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'sacramento', name: 'Sacramento', category: 'elegant', scale: 1.24, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'parisienne', name: 'Parisienne', category: 'elegant', scale: 1.14, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'pinyon-script', name: 'Pinyon Script', category: 'elegant', scale: 1.28, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'italianno', name: 'Italianno', category: 'elegant', scale: 1.60, license: 'OFL-1.1', joins: true, featured: false, init: true, fina: true },
  { id: 'tangerine', name: 'Tangerine', category: 'elegant', scale: 1.47, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'qwigley', name: 'Qwigley', category: 'elegant', scale: 1.28, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'herr-von-muellerhoff', name: 'Herr Von Muellerhoff', category: 'elegant', scale: 1.08, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'whisper', name: 'Whisper', category: 'elegant', scale: 1.12, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'mrs-saint-delafield', name: 'Mrs Saint Delafield', category: 'luxury', scale: 1.25, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'monsieur-la-doulaise', name: 'Monsieur La Doulaise', category: 'luxury', scale: 0.92, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'mr-dafoe', name: 'Mr Dafoe', category: 'luxury', scale: 1.12, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'mr-de-haviland', name: 'Mr De Haviland', category: 'luxury', scale: 1.12, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'meddon', name: 'Meddon', category: 'luxury', scale: 0.83, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'montecarlo', name: 'MonteCarlo', category: 'luxury', scale: 1.17, license: 'OFL-1.1', joins: true, featured: false, init: true, fina: false },
  { id: 'imperial-script', name: 'Imperial Script', category: 'luxury', scale: 1.25, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'corinthia', name: 'Corinthia', category: 'luxury', scale: 1.49, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'ephesis', name: 'Ephesis', category: 'luxury', scale: 1.10, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'aguafina-script', name: 'Aguafina Script', category: 'luxury', scale: 1.02, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'petit-formal-script', name: 'Petit Formal Script', category: 'luxury', scale: 0.93, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'dancing-script', name: 'Dancing Script', category: 'modern', scale: 1.10, license: 'OFL-1.1', joins: true, featured: true, init: true, fina: true },
  { id: 'satisfy', name: 'Satisfy', category: 'modern', scale: 0.97, license: 'Apache-2.0', joins: true, featured: false, init: false, fina: false },
  { id: 'yellowtail', name: 'Yellowtail', category: 'modern', scale: 1.10, license: 'Apache-2.0', joins: true, featured: false, init: false, fina: false },
  { id: 'cookie', name: 'Cookie', category: 'modern', scale: 1.34, license: 'OFL-1.1', joins: true, featured: false, init: true, fina: true },
  { id: 'damion', name: 'Damion', category: 'modern', scale: 1.22, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'grand-hotel', name: 'Grand Hotel', category: 'modern', scale: 1.13, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'arizonia', name: 'Arizonia', category: 'modern', scale: 1.12, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'euphoria-script', name: 'Euphoria Script', category: 'modern', scale: 1.08, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'style-script', name: 'Style Script', category: 'modern', scale: 0.95, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: true },
  { id: 'rochester', name: 'Rochester', category: 'modern', scale: 0.95, license: 'Apache-2.0', joins: true, featured: false, init: false, fina: false },
  { id: 'kaushan-script', name: 'Kaushan Script', category: 'modern', scale: 0.98, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'waterfall', name: 'Waterfall', category: 'artistic', scale: 1.45, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'windsong', name: 'WindSong', category: 'artistic', scale: 0.96, license: 'OFL-1.1', joins: true, featured: true, init: false, fina: false },
  { id: 'birthstone', name: 'Birthstone', category: 'artistic', scale: 1.34, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'birthstone-bounce', name: 'Birthstone Bounce', category: 'artistic', scale: 0.92, license: 'OFL-1.1', joins: true, featured: false, init: true, fina: true },
  { id: 'meow-script', name: 'Meow Script', category: 'artistic', scale: 1.07, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'rouge-script', name: 'Rouge Script', category: 'artistic', scale: 1.15, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'lavishly-yours', name: 'Lavishly Yours', category: 'artistic', scale: 1.20, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'passions-conflict', name: 'Passions Conflict', category: 'artistic', scale: 1.48, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'the-nautigal', name: 'The Nautigal', category: 'artistic', scale: 1.06, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'bonheur-royale', name: 'Bonheur Royale', category: 'artistic', scale: 1.12, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'ms-madi', name: 'Ms Madi', category: 'artistic', scale: 1.02, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'caveat', name: 'Caveat', category: 'natural', scale: 1.22, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'caveat-brush', name: 'Caveat Brush', category: 'natural', scale: 1.18, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'kalam', name: 'Kalam', category: 'natural', scale: 1.10, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'patrick-hand', name: 'Patrick Hand', category: 'natural', scale: 1.17, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'shadows-into-light', name: 'Shadows Into Light', category: 'natural', scale: 1.01, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'homemade-apple', name: 'Homemade Apple', category: 'natural', scale: 0.70, license: 'Apache-2.0', joins: true, featured: true, init: false, fina: false },
  { id: 'la-belle-aurore', name: 'La Belle Aurore', category: 'natural', scale: 1.05, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'nothing-you-could-do', name: 'Nothing You Could Do', category: 'natural', scale: 1.16, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
  { id: 'cedarville-cursive', name: 'Cedarville Cursive', category: 'natural', scale: 1.04, license: 'OFL-1.1', joins: true, featured: false, init: false, fina: false },
  { id: 'zeyada', name: 'Zeyada', category: 'natural', scale: 1.39, license: 'OFL-1.1', joins: false, featured: false, init: false, fina: false },
];

export const FONT_BY_ID: Record<string, StudioFont> = Object.fromEntries(
  STUDIO_FONTS.map((f) => [f.id, f]),
);

export type PenType =
  | 'ballpoint'
  | 'gel'
  | 'fountain'
  | 'flex'
  | 'calligraphy'
  | 'marker'
  | 'natural'
  | 'brush';

export const PENS: { id: PenType; label: string; hint: string }[] = [
  { id: 'ballpoint', label: 'Fine Ballpoint', hint: 'A light, even line.' },
  { id: 'gel', label: 'Smooth Gel Pen', hint: 'Smooth, steady width.' },
  { id: 'fountain', label: 'Fountain Pen', hint: 'Thick and thin strokes from an angled nib.' },
  { id: 'flex', label: 'Flexible Nib', hint: 'Swells with pressure, hairline on upstrokes.' },
  { id: 'calligraphy', label: 'Calligraphy Pen', hint: 'Broad, flat nib with strong contrast.' },
  { id: 'marker', label: 'Fine Marker', hint: 'Bold and uniform.' },
  { id: 'natural', label: 'Natural Ink', hint: 'Gentle pressure variation, like a real pen.' },
  { id: 'brush', label: 'Brush Pen', hint: 'Bold strokes that taper at the ends.' },
];

/** Pen controls shared by drawn strokes and elements. */
export interface PenSettings {
  /** How much pressure (or speed) changes the width, 0..100. */
  pressure: number;
  /** Ink opacity, 0.3..1. */
  opacity: number;
  /** Dry-ink texture, 0..100 (0 = none). */
  texture: number;
  /** Taper at stroke ends, 0..100. */
  taper: number;
}

export const DEFAULT_PEN_SETTINGS: PenSettings = { pressure: 50, opacity: 1, texture: 0, taper: 40 };

/** Adjustable text parameters. All are deterministic; nothing is random at render time. */
export interface TextParams {
  /** Degrees; positive leans right. -15..30 */
  slant: number;
  /** Extra space between letters as a fraction of size. -0.15..0.6 */
  spacing: number;
  /** Character height multiplier. 0.6..1.5 */
  height: number;
  /** Lowercase size relative to capitals, 0.7..1.3. */
  lower: number;
  /** Space between words (names) as a fraction of size, 0..1. */
  wordSpacing: number;
  /** Signature width multiplier. 0.6..1.6 */
  width: number;
  /** Extra ink weight, 0 (as drawn by the face) .. 3. */
  weight: number;
  /** Baseline movement, 0..10. */
  baseline: number;
  /** Curve intensity for entry/exit strokes, 0..100. */
  curve: number;
  /** Loop intensity for entry/exit strokes, 0..100. */
  loop: number;
  /** First-capital proportion, 0.8..1.9. */
  capitals: number;
  /** Connected-letter tightness, 0 (as the face spaces it) .. 1 (letters overlap to join). */
  connect: number;
  /** Descender length, -0.5 (short) .. 1 (long, sweeping). */
  descenders: number;
  /** Use the face's real initial-form glyph for the first letter of each word (if it has one). */
  initForms: boolean;
  /** Use the face's real final-form glyph for the last letter of each word (if it has one). */
  finaForms: boolean;
  /** Entry stroke into the first capital. */
  entry: boolean;
  /** Decorative exit tail after the last letter. */
  tail: boolean;
}

export const DEFAULT_TEXT_PARAMS: TextParams = {
  slant: 0,
  spacing: 0,
  height: 1,
  lower: 1,
  wordSpacing: 0.28,
  width: 1,
  weight: 0,
  baseline: 2,
  curve: 50,
  loop: 30,
  capitals: 1,
  connect: 0.2,
  descenders: 0,
  initForms: false,
  finaForms: false,
  entry: false,
  tail: false,
};

export interface StyleVariant {
  label: string;
  font: string;
  pen: PenType;
  params: Partial<TextParams>;
  /** Elements added with this variant (e.g. an underline). */
  underline?: ElementType;
}

export interface StyleFamily {
  id: string;
  label: string;
  description: string;
  variants: StyleVariant[];
}

export const STYLE_FAMILIES: StyleFamily[] = [
  {
    id: 'classic-cursive',
    label: 'Classic Cursive',
    description: 'Rounded, friendly joined writing.',
    variants: [
      { label: 'Classic', font: 'dancing-script', pen: 'natural', params: { connect: 0.25 } },
      {
        label: 'Classic with tail',
        font: 'dancing-script',
        pen: 'marker',
        params: { slant: 6, tail: true, curve: 55 },
      },
      { label: 'Rounded', font: 'satisfy', pen: 'natural', params: { connect: 0.3 } },
      {
        label: 'Rounded underline',
        font: 'satisfy',
        pen: 'natural',
        params: { slant: 4, capitals: 1.2 },
        underline: 'u-thin-curve',
      },
    ],
  },
  {
    id: 'executive',
    label: 'Executive Signature',
    description: 'Fast, confident strokes with a long lean.',
    variants: [
      {
        label: 'Executive',
        font: 'herr-von-muellerhoff',
        pen: 'fountain',
        params: { slant: 4, capitals: 1.35, tail: true },
      },
      {
        label: 'Executive sweep',
        font: 'herr-von-muellerhoff',
        pen: 'natural',
        params: { width: 1.2, capitals: 1.5 },
        underline: 'u-long-sweep',
      },
      { label: 'Boardroom', font: 'mr-dafoe', pen: 'marker', params: { capitals: 1.2 } },
      {
        label: 'Boardroom rising',
        font: 'mr-dafoe',
        pen: 'fountain',
        params: { slant: 6, tail: true },
        underline: 'u-rising',
      },
    ],
  },
  {
    id: 'modern-handwriting',
    label: 'Modern Handwriting',
    description: 'Relaxed everyday handwriting.',
    variants: [
      { label: 'Everyday', font: 'cedarville-cursive', pen: 'marker', params: { baseline: 4 } },
      {
        label: 'Everyday light',
        font: 'cedarville-cursive',
        pen: 'ballpoint',
        params: { slant: 8, spacing: 0.05 },
      },
      { label: 'Studio', font: 'sacramento', pen: 'gel', params: { weight: 0.8 } },
      {
        label: 'Studio underline',
        font: 'sacramento',
        pen: 'gel',
        params: { weight: 1, capitals: 1.25 },
        underline: 'u-straight',
      },
    ],
  },
  {
    id: 'elegant-calligraphy',
    label: 'Elegant Calligraphy',
    description: 'Formal calligraphic capitals and fine hairlines.',
    variants: [
      { label: 'Elegant', font: 'great-vibes', pen: 'fountain', params: { capitals: 1.15 } },
      {
        label: 'Elegant swash',
        font: 'great-vibes',
        pen: 'fountain',
        params: { capitals: 1.4, entry: true, curve: 65 },
      },
      { label: 'Copperplate', font: 'pinyon-script', pen: 'fountain', params: { slant: 2 } },
      {
        label: 'Copperplate flourish',
        font: 'pinyon-script',
        pen: 'fountain',
        params: { tail: true, loop: 60 },
      },
    ],
  },
  {
    id: 'luxury-flourish',
    label: 'Luxury Flourish',
    description: 'Ornate swashes and generous loops.',
    variants: [
      {
        label: 'Grand',
        font: 'monsieur-la-doulaise',
        pen: 'fountain',
        params: { capitals: 1.1 },
      },
      {
        label: 'Grand looping',
        font: 'monsieur-la-doulaise',
        pen: 'fountain',
        params: { loop: 80, tail: true },
        underline: 'u-looping',
      },
      { label: 'Regal', font: 'imperial-script', pen: 'fountain', params: { capitals: 1.2 } },
      {
        label: 'Regal entrance',
        font: 'imperial-script',
        pen: 'natural',
        params: { entry: true, loop: 70, curve: 70 },
      },
    ],
  },
  {
    id: 'fine-line',
    label: 'Fine-Line Script',
    description: 'Delicate, airy letterforms.',
    variants: [
      { label: 'Fine line', font: 'allura', pen: 'ballpoint', params: { spacing: 0.03 } },
      {
        label: 'Fine line tail',
        font: 'allura',
        pen: 'ballpoint',
        params: { tail: true, slant: 3 },
      },
      { label: 'Italian', font: 'italianno', pen: 'ballpoint', params: { width: 1.1 } },
      {
        label: 'Italian underline',
        font: 'italianno',
        pen: 'gel',
        params: { capitals: 1.3 },
        underline: 'u-final',
      },
    ],
  },
  {
    id: 'artistic-flow',
    label: 'Artistic Flow',
    description: 'Expressive, flowing and individual.',
    variants: [
      {
        label: 'Flowing',
        font: 'mrs-saint-delafield',
        pen: 'natural',
        params: { baseline: 5, capitals: 1.2 },
      },
      {
        label: 'Flowing ribbon',
        font: 'mrs-saint-delafield',
        pen: 'brush',
        params: { curve: 80 },
        underline: 'u-s-curve',
      },
      { label: 'Painterly', font: 'ms-madi', pen: 'natural', params: { connect: 0.3 } },
      {
        label: 'Painterly tail',
        font: 'ms-madi',
        pen: 'brush',
        params: { tail: true, loop: 55 },
      },
    ],
  },
  {
    id: 'bold-penmanship',
    label: 'Bold Penmanship',
    description: 'Strong, heavy strokes that stand out.',
    variants: [
      { label: 'Bold', font: 'kaushan-script', pen: 'brush', params: { weight: 0.6 } },
      {
        label: 'Bold underline',
        font: 'kaushan-script',
        pen: 'brush',
        params: { slant: 4 },
        underline: 'u-straight',
      },
      { label: 'Retro', font: 'yellowtail', pen: 'marker', params: { weight: 0.8 } },
      {
        label: 'Retro sweep',
        font: 'yellowtail',
        pen: 'brush',
        params: { tail: true },
        underline: 'u-long-sweep',
      },
    ],
  },
  {
    id: 'fountain-pen',
    label: 'Fountain Pen',
    description: 'Classic nib contrast between thick and thin.',
    variants: [
      { label: 'Nib', font: 'alex-brush', pen: 'fountain', params: { capitals: 1.15 } },
      {
        label: 'Nib with entrance',
        font: 'alex-brush',
        pen: 'fountain',
        params: { entry: true, slant: 4 },
      },
      { label: 'Formal', font: 'petit-formal-script', pen: 'fountain', params: { spacing: 0.02 } },
      {
        label: 'Formal double',
        font: 'petit-formal-script',
        pen: 'fountain',
        params: { capitals: 1.2 },
        underline: 'u-double',
      },
    ],
  },
  {
    id: 'minimal',
    label: 'Minimal Signature',
    description: 'Clean, understated and quick.',
    variants: [
      { label: 'Minimal', font: 'ephesis', pen: 'gel', params: { weight: 0.6 } },
      {
        label: 'Minimal line',
        font: 'ephesis',
        pen: 'gel',
        params: { weight: 0.6 },
        underline: 'u-straight',
      },
      { label: 'Whisper', font: 'whisper', pen: 'ballpoint', params: { weight: 0.4 } },
      {
        label: 'Whisper lean',
        font: 'whisper',
        pen: 'ballpoint',
        params: { slant: 10, weight: 0.4 },
      },
    ],
  },
  {
    id: 'dramatic-cursive',
    label: 'Dramatic Cursive',
    description: 'Tall capitals and sweeping descenders.',
    variants: [
      {
        label: 'Dramatic',
        font: 'corinthia',
        pen: 'fountain',
        params: { capitals: 1.45, descenders: 0.6 },
      },
      {
        label: 'Dramatic sweep',
        font: 'corinthia',
        pen: 'fountain',
        params: { capitals: 1.6, tail: true, curve: 75 },
        underline: 'u-descending',
      },
      {
        label: 'Parisian',
        font: 'parisienne',
        pen: 'natural',
        params: { capitals: 1.35, descenders: 0.4 },
      },
      {
        label: 'Parisian entrance',
        font: 'parisienne',
        pen: 'fountain',
        params: { entry: true, loop: 65 },
      },
    ],
  },
  {
    id: 'natural-handwriting',
    label: 'Natural Handwriting',
    description: 'Looks like a quick personal note.',
    variants: [
      { label: 'Natural', font: 'homemade-apple', pen: 'marker', params: { baseline: 4 } },
      {
        label: 'Natural slanted',
        font: 'homemade-apple',
        pen: 'natural',
        params: { slant: 6, baseline: 5 },
      },
      { label: 'Note', font: 'la-belle-aurore', pen: 'marker', params: { baseline: 3 } },
      {
        label: 'Note underline',
        font: 'la-belle-aurore',
        pen: 'natural',
        params: { connect: 0.35 },
        underline: 'u-thin-curve',
      },
    ],
  },
];

export const FAMILY_BY_ID: Record<string, StyleFamily> = Object.fromEntries(
  STYLE_FAMILIES.map((f) => [f.id, f]),
);

export const ELEMENT_IDS = [
  'u-straight',
  'u-thin-curve',
  'u-long-sweep',
  'u-rising',
  'u-descending',
  'u-double',
  'u-crossed',
  'u-looping',
  'u-initial',
  'u-final',
  'u-s-curve',
  'u-fountain',
  'u-wave',
  'u-sharp-end',
  'u-tail',
  'l-circle',
  'l-open',
  'l-closed',
  'l-oval',
  'l-extended',
  'l-double',
  'l-descender',
  'l-initial',
  'l-ending',
  'f-opening',
  'f-closing',
  'f-curved-tail',
  'f-rising-tail',
  'f-descending-tail',
  'f-spiral',
  'f-swoosh',
  'f-connector',
  'f-pen-trail',
  'freehand',
] as const;
export type ElementType = (typeof ELEMENT_IDS)[number];

export const ELEMENT_TYPES: { id: ElementType; label: string; group: 'underline' | 'loop' | 'flourish' }[] = [
  { id: 'u-straight', label: 'Straight Line', group: 'underline' },
  { id: 'u-thin-curve', label: 'Thin Curved Line', group: 'underline' },
  { id: 'u-long-sweep', label: 'Long Sweeping Line', group: 'underline' },
  { id: 'u-rising', label: 'Rising Underline', group: 'underline' },
  { id: 'u-descending', label: 'Descending Underline', group: 'underline' },
  { id: 'u-double', label: 'Double Line', group: 'underline' },
  { id: 'u-crossed', label: 'Crossed Underline', group: 'underline' },
  { id: 'u-looping', label: 'Looping Underline', group: 'underline' },
  { id: 'u-initial', label: 'Extended Initial Underline', group: 'underline' },
  { id: 'u-final', label: 'Extended Final Letter', group: 'underline' },
  { id: 'u-s-curve', label: 'S-Curve Underline', group: 'underline' },
  { id: 'u-fountain', label: 'Fountain Pen Stroke', group: 'underline' },
  { id: 'u-wave', label: 'Wave Underline', group: 'underline' },
  { id: 'u-sharp-end', label: 'Sharp Ending Stroke', group: 'underline' },
  { id: 'u-tail', label: 'Elegant Finishing Tail', group: 'underline' },
  { id: 'l-circle', label: 'Circular Loop', group: 'loop' },
  { id: 'l-open', label: 'Open Loop', group: 'loop' },
  { id: 'l-closed', label: 'Closed Loop', group: 'loop' },
  { id: 'l-oval', label: 'Oval Loop', group: 'loop' },
  { id: 'l-extended', label: 'Extended Loop', group: 'loop' },
  { id: 'l-double', label: 'Double Loop', group: 'loop' },
  { id: 'l-descender', label: 'Descender Loop', group: 'loop' },
  { id: 'l-initial', label: 'Initial Letter Loop', group: 'loop' },
  { id: 'l-ending', label: 'Ending Letter Loop', group: 'loop' },
  { id: 'f-opening', label: 'Opening Flourish', group: 'flourish' },
  { id: 'f-closing', label: 'Closing Flourish', group: 'flourish' },
  { id: 'f-curved-tail', label: 'Curved Tail', group: 'flourish' },
  { id: 'f-rising-tail', label: 'Rising Tail', group: 'flourish' },
  { id: 'f-descending-tail', label: 'Descending Tail', group: 'flourish' },
  { id: 'f-spiral', label: 'Spiral', group: 'flourish' },
  { id: 'f-swoosh', label: 'Swoosh', group: 'flourish' },
  { id: 'f-connector', label: 'Decorative Connector', group: 'flourish' },
  { id: 'f-pen-trail', label: 'Extended Pen Trail', group: 'flourish' },
  { id: 'freehand', label: 'Custom Freehand Flourish', group: 'flourish' },
];

/** Default ink palette. Admins can narrow it in settings. */
export const STUDIO_INKS: { id: string; label: string; color: string }[] = [
  { id: 'navy', label: 'Midnight navy', color: '#0D1B33' },
  { id: 'black', label: 'Black', color: '#111111' },
  { id: 'blue', label: 'Royal blue', color: '#1D4ED8' },
  { id: 'purple', label: 'Dark purple', color: '#5B3FA0' },
  { id: 'burgundy', label: 'Burgundy', color: '#7F1D3A' },
  { id: 'green', label: 'Forest green', color: '#166534' },
];

/** Fictional sample names for demos and placeholders. Never a real person's name. */
export const SAMPLE_NAMES = ['Jordan Lee', 'Alex Morgan', 'Taylor Smith'];
