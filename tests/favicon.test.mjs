import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import { faviconData } from '../src/lib/favicon.ts';
import { applyBrowserStatus } from '../src/lib/browserStatus.ts';
import { createTab, applyTabStatus, enableTabSplit, separateTabSplit, swapTabPages } from '../src/lib/tabState.ts';
import { loadBookmarks, putBookmark, saveBookmarks, updateBookmarkFavicons } from '../src/lib/bookmarks.ts';
import { importBookmarkHtml, exportBookmarkHtml } from '../src/lib/bookmarkTransfer.ts';

const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=';
const other = 'data:image/png;base64,iVBORw0KGgo=';
const empty = () => ({ bookmarks: [], folders: [] });

test('icons are cached image data rather than remote URLs, executable markup, or unbounded strings', () => {
  assert.equal(faviconData(icon), icon);
  for (const value of [undefined, null, '', 'https://example.com/favicon.png', 'file:///icon.png', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,broken',
    'data:image/png;base64,' + 'A'.repeat(180_000)]) assert.equal(faviconData(value), undefined);
});

test('favicon events update only the matching page and ignore late callbacks without changing its URL', () => {
  const tab = createTab('page', 'https://example.com/one');
  const loaded = applyBrowserStatus(tab, { favicon: icon, faviconPageUrl: tab.url });
  assert.equal(loaded.favicon, icon);
  const changed = applyBrowserStatus(loaded, { favicon: other, faviconPageUrl: tab.url });
  assert.equal(changed.favicon, other);
  assert.equal(applyBrowserStatus(changed, { favicon: icon, faviconPageUrl: 'https://old.example/' }).favicon, other);
  assert.equal(applyBrowserStatus(changed, { url: 'https://different.example/' }).favicon, undefined);
  assert.equal(applyBrowserStatus(changed, { url: 'https://example.com/two#section' }).favicon, other, 'same-site history keeps the icon until native refresh');
  const cleared = applyBrowserStatus(changed, { favicon: '', faviconPageUrl: tab.url });
  assert.equal(cleared.favicon, undefined);
  assert.equal(cleared.url, tab.url);
});

test('background split pages keep their own icons after swapping and detaching', () => {
  let pair = enableTabSplit(createTab('pair', 'https://left.example/'), 'right');
  pair.split.url = 'https://right.example/';
  let tabs = applyTabStatus([pair], { tabId: 'pair', pane: 'primary', favicon: icon, faviconPageUrl: pair.url });
  tabs = applyTabStatus(tabs, { tabId: 'right', pane: 'primary', favicon: other, faviconPageUrl: pair.split.url });
  const swapped = swapTabPages(tabs[0]);
  const detached = separateTabSplit({ tabs: [swapped], activeTabId: swapped.id }, swapped.id);
  assert.deepEqual(detached.tabs.map((tab) => tab.favicon), [other, icon]);
  const changed = applyTabStatus(detached.tabs, { tabId: 'right', pane: 'primary', favicon: icon, faviconPageUrl: pair.split.url });
  assert.equal(changed[0].favicon, icon);
  assert.equal(changed[1].favicon, icon);
});

test('bookmark icons persist across reload, editing, moving folders and safe Chrome/Edge HTML transfers', () => {
  let data = putBookmark(empty(), { title: 'Saved', url: 'https://example.com/', folderId: null, favicon: icon });
  const original = data.bookmarks[0];
  data = putBookmark(data, { id: original.id, title: 'Renamed', url: original.url, folderId: null, newFolder: 'Folder' });
  assert.equal(data.bookmarks[0].favicon, icon);
  let saved;
  saveBookmarks({ setItem: (_, value) => { saved = value; } }, data);
  assert.equal(loadBookmarks({ getItem: () => saved }).bookmarks[0].favicon, icon);
  const html = exportBookmarkHtml(data);
  assert.ok(html.includes(`ICON="${icon}"`));
  assert.equal(importBookmarkHtml(html, empty()).data.bookmarks[0].favicon, icon);
  data = putBookmark(data, { ...data.bookmarks[0], url: 'https://different.example/' });
  assert.equal(data.bookmarks[0].favicon, undefined, 'editing the URL must not retain the previous site icon');
  const unsafe = importBookmarkHtml('<DL><DT><A HREF="https://example.com/" ICON="https://tracker.example/icon">Safe</A></DL>', empty());
  assert.equal(unsafe.data.bookmarks[0].favicon, undefined);
});

test('older bookmarks gain cached icons when revisited, without altering other entries or failing on bad icons', () => {
  let data = putBookmark(empty(), { title: 'Saved', url: 'https://example.com/', folderId: null });
  const original = data;
  data = updateBookmarkFavicons(data, 'https://example.com/', icon);
  assert.equal(data.bookmarks[0].favicon, icon);
  assert.equal(original.bookmarks[0].favicon, undefined);
  assert.equal(updateBookmarkFavicons(data, 'https://example.com/', icon), data);
  assert.equal(updateBookmarkFavicons(data, 'https://other.example/', other), data);
  assert.equal(updateBookmarkFavicons(data, 'https://example.com/', 'https://remote.example/icon.png'), data);
  const malformed = { ...data, bookmarks: [{ ...data.bookmarks[0], favicon: 'javascript:invalid' }] };
  assert.equal(loadBookmarks({ getItem: () => JSON.stringify(malformed) }).bookmarks[0].favicon, undefined);
});

test('icon rendering falls back on missing or failed images and recovers for a new icon', () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/components/SiteIcon.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let failed;
  const output = { exports: {} };
  const require = (name) => {
    if (name === 'react') return { useState: () => [failed, (value) => { failed = value; }] };
    if (name === '../lib/favicon') return { faviconData };
    if (name === 'react/jsx-runtime') return { Fragment: React.Fragment, jsx: (type, props) => React.createElement(type, props) };
    assert.fail(name);
  };
  new Function('require', 'module', 'exports', code)(require, output, output.exports);
  const fallback = React.createElement('svg', { 'data-default-icon': true });
  const render = (favicon) => output.exports.SiteIcon({ favicon, fallback });
  assert.equal(render(undefined).props.children, fallback);
  assert.equal(render(icon).type, 'img');
  render(icon).props.onError();
  assert.equal(render(icon).props.children, fallback);
  assert.equal(render(other).type, 'img');
});
