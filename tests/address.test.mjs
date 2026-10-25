import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAddress } from '../src/lib/address.ts';

test('absolute Windows file paths open the actual file rather than becoming search queries', () => {
  const expected = 'file:///B:/AIB/AuraView/tests/fixtures/favicon-check.html';
  for (const input of ['B:/AIB/AuraView/tests/fixtures/favicon-check.html',
    String.raw`B:\AIB\AuraView\tests\fixtures\favicon-check.html`,
    String.raw`"B:\AIB\AuraView\tests\fixtures\favicon-check.html"`,
    '  b:/AIB/AuraView/tests/fixtures/favicon-check.html  ']) {
    assert.equal(resolveAddress(input), expected);
  }
});

test('raw path punctuation is encoded as filename text and file URLs preserve explicit fragments', () => {
  assert.equal(resolveAddress(String.raw`C:\My pages\café #1?100%.html`),
    'file:///C:/My%20pages/caf%C3%A9%20%231%3F100%25.html');
  assert.equal(resolveAddress('file:///C:/My%20pages/page.html#section'), 'file:///C:/My%20pages/page.html#section');
  assert.equal(resolveAddress('"file:///C:/My%20pages/page.html"'), 'file:///C:/My%20pages/page.html');
  assert.equal(resolveAddress('file://[invalid'), undefined);
});

test('website addresses, local servers and ordinary search text keep their existing behavior', () => {
  assert.equal(resolveAddress('8188'), 'http://localhost:8188');
  assert.equal(resolveAddress('localhost:8188/path'), 'http://localhost:8188/path');
  assert.equal(resolveAddress('https://example.com/path?q=one#two'), 'https://example.com/path?q=one#two');
  assert.equal(resolveAddress('example.com/path'), 'https://example.com/path');
  assert.equal(resolveAddress('ordinary search words'), 'https://www.google.com/search?q=ordinary%20search%20words');
  assert.equal(resolveAddress('B:relative-path.html'), 'https://www.google.com/search?q=B%3Arelative-path.html');
  assert.equal(resolveAddress('  '), undefined);
});
