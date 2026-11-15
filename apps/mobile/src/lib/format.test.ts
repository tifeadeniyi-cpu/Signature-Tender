import { formatBytes, greeting, pdfName, plural, signingTokenFrom } from './format';

const token = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-ab';

test('reads a signing token from a link or a bare token, and nothing else', () => {
  expect(signingTokenFrom(`https://signaturetender.com/sign/${token}`)).toBe(token);
  expect(signingTokenFrom(`  signaturetender.com/sign/${token}?x=1 `)).toBe(token);
  expect(signingTokenFrom(token)).toBe(token);
  expect(signingTokenFrom(`https://evil.example/sign/${token}`)).toBeNull();
  expect(signingTokenFrom('https://signaturetender.com/app')).toBeNull();
  expect(signingTokenFrom('short')).toBeNull();
});

test('formats sizes, counts, names and greetings', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  expect(plural(1, 'signer')).toBe('1 signer');
  expect(plural(3, 'signer')).toBe('3 signers');
  expect(pdfName('Lease: final?.pdf', ' - certificate')).toBe('Lease_ final_ - certificate.pdf');
  expect(greeting(9)).toBe('Good morning');
  expect(greeting(20)).toBe('Good evening');
});
