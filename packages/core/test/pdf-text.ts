import { inflateSync } from 'node:zlib';

/** Decompressed content of every stream in a PDF, joined. Good enough to look for drawn text. */
export function pdfContent(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = buf.indexOf('stream', i, 'latin1');
    if (s === -1) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf('endstream', start, 'latin1');
    if (e === -1) break;
    const chunk = buf.subarray(start, e);
    try {
      out.push(inflateSync(chunk).toString('latin1'));
    } catch {
      out.push(chunk.toString('latin1'));
    }
    i = e + 9;
  }
  return out.join('\n');
}

/** How pdf-lib writes standard-font text: a hex string of WinAnsi codes. */
export function pdfHex(text: string): string {
  return `<${Buffer.from(text, 'latin1').toString('hex').toUpperCase()}>`;
}
