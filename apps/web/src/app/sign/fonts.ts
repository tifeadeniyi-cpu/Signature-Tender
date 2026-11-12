import { Dancing_Script, Great_Vibes, Caveat } from 'next/font/google';

export const dancing = Dancing_Script({ subsets: ['latin'], weight: '600', display: 'swap' });
export const vibes = Great_Vibes({ subsets: ['latin'], weight: '400', display: 'swap' });
export const caveat = Caveat({ subsets: ['latin'], weight: '600', display: 'swap' });

export const SIGNATURE_FONTS = [
  { id: 'Dancing Script', family: dancing.style.fontFamily, className: dancing.className },
  { id: 'Great Vibes', family: vibes.style.fontFamily, className: vibes.className },
  { id: 'Caveat', family: caveat.style.fontFamily, className: caveat.className },
];
