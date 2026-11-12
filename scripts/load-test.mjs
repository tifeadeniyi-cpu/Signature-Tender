#!/usr/bin/env node
/**
 * Repeatable load test with no dependencies (Node 22+).
 *
 *   BASE_URL=https://staging.example.com node scripts/load-test.mjs
 *
 * Options (environment variables):
 *   BASE_URL       required. Never point this at production with real customers.
 *   ROUTES         comma-separated paths (default: /api/health,/sign-in,/retrieve,/pricing)
 *   CONCURRENCY    parallel connections per route (default 25)
 *   DURATION       seconds per route (default 15)
 *   BYPASS_TOKEN   optional Vercel protection bypass token for protected previews
 *
 * Prints requests per second, p50, p97.5 and p99 latency, and non-2xx/3xx counts per route.
 * Exits 1 when any route has errors or a p99 above P99_BUDGET_MS (default 1500).
 */
const base = process.env.BASE_URL;
if (!base) {
  console.error('Set BASE_URL, for example BASE_URL=http://localhost:3000');
  process.exit(2);
}
const routes = (process.env.ROUTES ?? '/api/health,/sign-in,/retrieve,/pricing').split(',');
const concurrency = Number(process.env.CONCURRENCY ?? 25);
const duration = Number(process.env.DURATION ?? 15) * 1000;
const budget = Number(process.env.P99_BUDGET_MS ?? 1500);
const headers = { 'user-agent': 'SignatureTender-LoadTest/1' };
if (process.env.BYPASS_TOKEN) headers['x-vercel-protection-bypass'] = process.env.BYPASS_TOKEN;

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function run(path) {
  const url = new URL(path, base).toString();
  const times = [];
  let errors = 0;
  const end = Date.now() + duration;
  const worker = async () => {
    while (Date.now() < end) {
      const t = performance.now();
      try {
        const res = await fetch(url, { headers, redirect: 'manual' });
        await res.arrayBuffer();
        if (res.status >= 400) errors++;
      } catch {
        errors++;
      }
      times.push(performance.now() - t);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  times.sort((a, b) => a - b);
  return {
    route: path,
    rps: Math.round(times.length / (duration / 1000)),
    p50: Math.round(pct(times, 50)),
    p975: Math.round(pct(times, 97.5)),
    p99: Math.round(pct(times, 99)),
    errors,
  };
}

const results = [];
for (const r of routes) results.push(await run(r.trim()));
console.log(`\n${base}  concurrency ${concurrency}, ${duration / 1000}s per route\n`);
console.log('| Route | Requests/s | p50 | p97.5 | p99 | Errors |');
console.log('| ----- | ---------- | --- | ----- | --- | ------ |');
for (const r of results)
  console.log(
    `| \`${r.route}\` | ${r.rps} | ${r.p50} ms | ${r.p975} ms | ${r.p99} ms | ${r.errors} |`,
  );
process.exit(results.some((r) => r.errors || r.p99 > budget) ? 1 : 0);
