import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinnedPost } from '../src/webhooks';

describe('webhook sender checks the address when it connects', () => {
  let server: http.Server;
  let port = 0;
  const bodies: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        bodies.push(b);
        res
          .writeHead(req.url === '/moved' ? 302 : 200, { location: 'http://127.0.0.1/' })
          .end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('delivers to localhost only when local development allows it, and never follows redirects', async () => {
    const opts = { timeoutMs: 2000, allowLocalhost: true };
    expect(await pinnedPost(`http://localhost:${port}/hook`, {}, '{"a":1}', opts)).toBe(200);
    expect(bodies.at(-1)).toBe('{"a":1}');
    expect(await pinnedPost(`http://localhost:${port}/moved`, {}, '{}', opts)).toBe(302);
    expect(bodies.length).toBe(2);
  });

  it('refuses a host name that resolves to a private address at connect time', async () => {
    await expect(
      pinnedPost(`https://localhost:${port}/hook`, {}, '{}', { timeoutMs: 2000 }),
    ).rejects.toThrow(/public internet address/);
    await expect(
      pinnedPost(`https://127.0.0.1:${port}/hook`, {}, '{}', { timeoutMs: 2000 }),
    ).rejects.toThrow(/public internet address/);
    await expect(
      pinnedPost(`http://localhost:${port}/hook`, {}, '{}', { timeoutMs: 2000 }),
    ).rejects.toThrow(/https/);
    expect(bodies.length).toBe(2);
  });
});
