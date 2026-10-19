import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAddress } from '../src/lib/address.ts';
import { applyBrowserStatus } from '../src/lib/browserStatus.ts';

const tab = (url) => ({ id: url, title: url, url, inputUrl: url,
  isLoading: true, canGoBack: false, canGoForward: false });

test('both address bars accept AI ports, loopback URLs, web addresses, and searches', () => {
  assert.equal(resolveAddress(' 8188 '), 'http://localhost:8188');
  assert.equal(resolveAddress('localhost:7860/path'), 'http://localhost:7860/path');
  assert.equal(resolveAddress('127.0.0.1:8188/'), 'http://127.0.0.1:8188/');
  assert.equal(resolveAddress('[::1]:8188/'), 'http://[::1]:8188/');
  assert.equal(resolveAddress('example.com/page'), 'https://example.com/page');
  assert.equal(resolveAddress('https://example.com'), 'https://example.com');
  assert.equal(resolveAddress('image generation'), 'https://www.google.com/search?q=image%20generation');
  assert.equal(resolveAddress('   '), undefined);
});

test('a pane redirect updates its URL and history without mutating the other pane', () => {
  const left = tab('http://localhost:8188');
  const right = tab('http://localhost:7860');
  const updated = applyBrowserStatus(right, { pane: 'secondary', url: 'http://localhost:7860/ui',
    title: 'Gradio', isLoading: false, canGoBack: true, canGoForward: false });
  assert.equal(updated.url, 'http://localhost:7860/ui');
  assert.equal(updated.inputUrl, updated.url);
  assert.equal(updated.title, 'Gradio');
  assert.equal(updated.canGoBack, true);
  assert.equal(updated.isLoading, false);
  assert.equal(left.url, 'http://localhost:8188');
  assert.equal(left.isLoading, true);
  assert.equal(right.url, 'http://localhost:7860');
});

test('offline pane status stops loading while preserving its requested address', () => {
  const right = tab('http://localhost:7860');
  const updated = applyBrowserStatus(right, { pane: 'secondary',
    url: 'data:text/html;base64,test', title: 'Local AI Server Offline • AuraView', isLoading: false,
    canGoBack: null, canGoForward: null });
  assert.equal(updated.url, right.url);
  assert.equal(updated.title, right.title);
  assert.equal(updated.isLoading, false);
  assert.equal(updated.canGoBack, false);
  assert.equal(updated.canGoForward, false);
});
