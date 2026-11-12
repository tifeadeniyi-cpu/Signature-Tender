import { Allura, Kaushan_Script, Mrs_Saint_Delafield } from 'next/font/google';
import { SIGNATURE_FONTS } from '@/app/sign/fonts';

// All fonts are from Google Fonts under the SIL Open Font License.
const allura = Allura({ subsets: ['latin'], weight: '400', display: 'swap' });
const kaushan = Kaushan_Script({ subsets: ['latin'], weight: '400', display: 'swap' });
const delafield = Mrs_Saint_Delafield({ subsets: ['latin'], weight: '400', display: 'swap' });

const app = Object.fromEntries(SIGNATURE_FONTS.map((f) => [f.id, f]));

export interface SignatureFamily {
  id: string;
  label: string;
  font: string;
  family: string;
  /** Already offered when signing a document today. The others are Signature Studio previews. */
  inApp: boolean;
  /** Visual size tweak so every family reads at a similar height. */
  scale: number;
}

export const SIGNATURE_FAMILIES: SignatureFamily[] = [
  {
    id: 'classic',
    label: 'Classic Cursive',
    font: 'Dancing Script',
    family: app['Dancing Script']!.family,
    inApp: true,
    scale: 1,
  },
  {
    id: 'calligraphy',
    label: 'Luxury Calligraphy',
    font: 'Great Vibes',
    family: app['Great Vibes']!.family,
    inApp: true,
    scale: 1.15,
  },
  {
    id: 'modern',
    label: 'Modern Signature',
    font: 'Caveat',
    family: app['Caveat']!.family,
    inApp: true,
    scale: 1.05,
  },
  {
    id: 'bold',
    label: 'Bold & Expressive',
    font: 'Kaushan Script',
    family: kaushan.style.fontFamily,
    inApp: false,
    scale: 0.95,
  },
  {
    id: 'delicate',
    label: 'Delicate Script',
    font: 'Allura',
    family: allura.style.fontFamily,
    inApp: false,
    scale: 1.2,
  },
  {
    id: 'artistic',
    label: 'Artistic Signature',
    font: 'Mrs Saint Delafield',
    family: delafield.style.fontFamily,
    inApp: false,
    scale: 1.3,
  },
];
