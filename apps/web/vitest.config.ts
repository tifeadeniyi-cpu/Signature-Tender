import { fileURLToPath as __toPath } from 'node:url';
const __dirname = __toPath(new URL('.', import.meta.url));
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/*.test.ts'] },
});
