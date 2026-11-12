/** Recipient colors (spec Part 15). Each pairs with the recipient's name so meaning never relies on color alone. */
export const RECIPIENT_COLORS = [
  { border: '#0d1b33', bg: 'rgba(13,27,51,0.10)', text: '#0d1b33' },
  { border: '#1d4ed8', bg: 'rgba(29,78,216,0.10)', text: '#1d4ed8' },
  { border: '#15803d', bg: 'rgba(21,128,61,0.10)', text: '#15803d' },
  { border: '#b45309', bg: 'rgba(180,83,9,0.12)', text: '#92400e' },
  { border: '#7c3aed', bg: 'rgba(124,58,237,0.10)', text: '#6d28d9' },
  { border: '#0e7490', bg: 'rgba(14,116,144,0.10)', text: '#0e7490' },
  { border: '#be185d', bg: 'rgba(190,24,93,0.10)', text: '#be185d' },
  { border: '#4b5563', bg: 'rgba(75,85,99,0.10)', text: '#374151' },
] as const;

export const colorFor = (i: number) => RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]!;
