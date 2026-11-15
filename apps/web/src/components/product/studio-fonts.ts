import { SIGNATURE_FONTS } from '@/app/sign/fonts';

const app = Object.fromEntries(SIGNATURE_FONTS.map((f) => [f.id, f]));

export interface SignatureFamily {
  id: string;
  label: string;
  font: string;
  family: string;
  /** Offered when signing a document. */
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
    font: 'Herr Von Muellerhoff',
    family: app['Herr Von Muellerhoff']!.family,
    inApp: true,
    scale: 1.35,
  },
  {
    id: 'bold',
    label: 'Bold & Expressive',
    font: 'Kaushan Script',
    family: app['Kaushan Script']!.family,
    inApp: true,
    scale: 0.95,
  },
  {
    id: 'delicate',
    label: 'Delicate Script',
    font: 'Allura',
    family: app['Allura']!.family,
    inApp: true,
    scale: 1.2,
  },
  {
    id: 'artistic',
    label: 'Artistic Signature',
    font: 'Mrs Saint Delafield',
    family: app['Mrs Saint Delafield']!.family,
    inApp: true,
    scale: 1.3,
  },
];
