'use client';

import type { ReactNode } from 'react';

/** Opens the browser's print dialog, where the report can be saved as a PDF. */
export function PrintButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}
