import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="font-display text-4xl">Page not found</h1>
      <p>The page you are looking for does not exist or you do not have access to it.</p>
      <ButtonLink href="/">Go home</ButtonLink>
    </main>
  );
}
