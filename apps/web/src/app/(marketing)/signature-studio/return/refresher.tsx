'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Re-checks our own records every two seconds for up to two minutes. */
export function Refresher() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 60) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return tries >= 60 ? (
    <p className="mt-4 text-sm">This is taking longer than usual. Your payment is safe; check your library in a few minutes.</p>
  ) : null;
}
