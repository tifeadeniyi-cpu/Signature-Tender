// The app reuses the website's response types. They are copied (the app is not in the pnpm
// workspace), so CI fails if a copy drifts from the website's file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pairs = [
  ['src/lib/shared/board-types.ts', '../web/src/lib/board-types.ts'],
  ['src/lib/shared/document-summary-types.ts', '../web/src/lib/document-summary-types.ts'],
];
let bad = 0;
for (const [mine, theirs] of pairs) {
  if (readFileSync(root + mine, 'utf8') !== readFileSync(root + theirs, 'utf8')) {
    console.error(`${mine} differs from apps/web/${theirs.slice(7)}. Copy it again.`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('Shared types match the website.');
