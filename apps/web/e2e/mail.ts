import { fileURLToPath as __toPath } from 'node:url';
const __dirname = __toPath(new URL('.', import.meta.url));
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(__dirname, '../.mail-e2e');

/** Waits for the newest dev-mail message to an address and returns the first link in it. */
export async function latestLinkFor(
  email: string,
  subjectIncludes: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await fs.readdir(DIR).catch(() => [])).sort().reverse();
    for (const f of files) {
      const msg = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8')) as {
        to: string;
        subject: string;
        text: string;
      };
      if (msg.to === email && msg.subject.includes(subjectIncludes)) {
        const m = msg.text.match(/https?:\/\/\S+/);
        if (m) return m[0];
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subjectIncludes}" email for ${email}`);
}

/** Waits for the newest dev-mail message to an address whose subject matches, and returns it. */
export async function latestMail(email: string, subjectIncludes: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await fs.readdir(DIR).catch(() => [])).sort().reverse();
    for (const f of files) {
      const msg = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8')) as {
        to: string;
        subject: string;
        text: string;
      };
      if (msg.to === email && msg.subject.includes(subjectIncludes)) return msg;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subjectIncludes}" email for ${email}`);
}
