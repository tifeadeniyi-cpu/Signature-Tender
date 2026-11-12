'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the server every few seconds for up to two minutes. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= 40) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
