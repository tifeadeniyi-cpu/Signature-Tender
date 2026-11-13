import {
  Allura,
  Dancing_Script,
  Great_Vibes,
  Herr_Von_Muellerhoff,
  Kaushan_Script,
  Mrs_Saint_Delafield,
} from 'next/font/google';

// All signature faces are from Google Fonts under the SIL Open Font License, self-hosted by Next.
export const dancing = Dancing_Script({ subsets: ['latin'], weight: '600', display: 'swap' });
export const vibes = Great_Vibes({ subsets: ['latin'], weight: '400', display: 'swap' });
const herr = Herr_Von_Muellerhoff({ subsets: ['latin'], weight: '400', display: 'swap' });
const kaushan = Kaushan_Script({ subsets: ['latin'], weight: '400', display: 'swap' });
const allura = Allura({ subsets: ['latin'], weight: '400', display: 'swap' });
const delafield = Mrs_Saint_Delafield({ subsets: ['latin'], weight: '400', display: 'swap' });

/** Font faces used by the six Signature Studio families. `id` is what an adoption records. */
export const SIGNATURE_FONTS = [
  { id: 'Dancing Script', family: dancing.style.fontFamily, className: dancing.className },
  { id: 'Great Vibes', family: vibes.style.fontFamily, className: vibes.className },
  { id: 'Herr Von Muellerhoff', family: herr.style.fontFamily, className: herr.className },
  { id: 'Kaushan Script', family: kaushan.style.fontFamily, className: kaushan.className },
  { id: 'Allura', family: allura.style.fontFamily, className: allura.className },
  {
    id: 'Mrs Saint Delafield',
    family: delafield.style.fontFamily,
    className: delafield.className,
  },
];
