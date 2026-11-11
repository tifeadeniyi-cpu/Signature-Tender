'use client';
import { Button } from '@/components/ui/button';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="font-display text-3xl">Something went wrong</h1>
      <p>We could not load this page. Your data has not been changed.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
