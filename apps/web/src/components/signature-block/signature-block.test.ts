import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutSignatureBlock } from '@st/core/signature-block/layout';
import { SignatureBlock, type SignatureBlockProps } from './signature-block';

const props: SignatureBlockProps = {
  widthPt: 220,
  heightPt: 80,
  imageSrc: 'data:image/png;base64,AAAA',
  name: 'Alex Morgan',
  role: 'Signer',
  timestamp: { state: 'completed', signedAt: '2026-11-12T15:24:00Z', timeZone: 'America/New_York' },
};
const html = (p: Partial<SignatureBlockProps> = {}) =>
  renderToStaticMarkup(createElement(SignatureBlock, { ...props, ...p }));

describe('SignatureBlock (screen)', () => {
  it('draws the same primitives the PDF uses, in PDF points', () => {
    const out = html();
    const layout = layoutSignatureBlock({
      width: 220,
      height: 80,
      name: 'Alex Morgan',
      role: 'Signer',
      timestamp: props.timestamp,
    });
    expect(out).toContain('viewBox="0 0 220 80"');
    for (const p of layout.primitives) {
      if (p.kind === 'text') {
        expect(out).toContain(`>${p.text}</text>`);
        expect(out).toContain(`textLength="${p.width}"`);
      }
      if (p.kind === 'seal')
        expect(out).toContain(`translate(${p.x} ${p.y}) scale(${p.size / 32})`);
    }
    expect(out).toContain('Signed on Nov 12, 2026 at 10:24 AM (EST)');
    expect(out).toContain('data-part="seal"');
    expect(out).toContain('preserveAspectRatio="xMinYMax meet"'); // signature kept in proportion
  });

  it('is zoom independent: the markup depends only on the field size in points', () => {
    expect(html()).toBe(html({ className: undefined }));
    expect(html()).toContain('width="100%"');
  });

  it('shows no time and no seal before the server records the signing', () => {
    const out = html({ timestamp: { state: 'pending', timeZone: 'America/New_York' } });
    expect(out).not.toContain('data-part="seal"');
    expect(out).not.toMatch(/Signed on/);
    expect(out).toContain('Signing time is added when you finish');
    expect(out).toContain('data-state="pending"');
  });

  it('renders initials as the mark only', () => {
    const out = html({ kind: 'initials', widthPt: 60, heightPt: 30 });
    expect(out).not.toContain('<text');
    expect(out).toContain('data-signature-block="signature"');
  });
});
