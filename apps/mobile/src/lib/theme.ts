/** Signature Tender's brand, as used on the website (apps/web/src/app/globals.css). */
export const colors = {
  navy: '#0D1B33',
  royal: '#172D4D',
  gold: '#D8AF68',
  softGold: '#F3DEB4',
  ivory: '#FFF9F2',
  cream: '#F6F0E7',
  white: '#FFFFFF',
  text: '#475569',
  heading: '#0D1B33',
  border: '#E7E1D6',
  navySurface: '#EAEEF5',
  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  error: '#B91C1C',
  errorBg: '#FEE2E2',
  info: '#1D4ED8',
  infoBg: '#DBEAFE',
};

export const fonts = {
  display: 'DMSerifDisplay_400Regular',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

/** Column colours match the website's Kanban board. */
export const columnStyle = {
  drafts: { label: 'Drafts', head: '#FBEED3', icon: '#9A6412' },
  sent: { label: 'Sent', head: '#E2ECFB', icon: '#1D4ED8' },
  in_progress: { label: 'In progress', head: '#E7E5FB', icon: '#4C3FC4' },
  completed: { label: 'Completed', head: '#DAF2E2', icon: '#15803D' },
  declined_expired: { label: 'Declined / Expired', head: '#FBE2E2', icon: '#B91C1C' },
  cancelled: { label: 'Cancelled', head: '#ECEEF2', icon: '#475569' },
} as const;

export const toneStyle = {
  neutral: { bg: colors.navySurface, fg: colors.navy },
  info: { bg: colors.infoBg, fg: colors.info },
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.warningBg, fg: colors.warning },
  error: { bg: colors.errorBg, fg: colors.error },
} as const;
