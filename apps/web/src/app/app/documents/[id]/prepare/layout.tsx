import type { ReactNode } from 'react';

export default function PrepareLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl">{children}</div>;
}
