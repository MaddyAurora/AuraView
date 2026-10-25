import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { addTab, applyTabStatus, closeTab, closeTabPage, createTab, enableTabSplit, orderedTabPages, reopenTab, selectTab, separateTabSplit, swapTabPages, tabPageView, tabViews, toggleSessionSplit } from '../src/lib/tabState.ts';
import * as tabMenu from '../src/lib/tabContextMenu.ts';

function splitTab(id, rightUrl = 'https://www.youtube.com') {
  const tab = enableTabSplit(createTab(id), `${id}-right`);
  return { ...tab, title: 'Google', isLoading: false,
    split: { ...tab.split, url: rightUrl, title: 'YouTube', isLoading: false } };
}

test('a split tab is restored after creating and visiting a normal tab', () => {
  const paired = splitTab('pair');
  let session = { tabs: [paired], activeTabId: paired.id };
  session = addTab(session, createTab('new'));
  assert.equal(session.activeTabId, 'new');
  assert.equal(session.tabs[1].splitEnabled, undefined);
  session = selectTab(session, 'pair');
  assert.equal(session.activeTabId, 'pair');
  assert.equal(session.tabs[0], paired);
  assert.equal(session.tabs[0].splitEnabled, true);
  assert.equal(session.tabs[0].split.url, 'https://www.youtube.com');
});

test('existing normal tabs stay normal when leaving a split tab', () => {
  const paired = splitTab('pair');
  const normal = createTab('normal', 'http://localhost:8188');
  const session = selectTab({ tabs: [paired, normal], activeTabId: 'pair' }, 'normal');
  assert.equal(session.activeTabId, 'normal');
  assert.equal(normal.splitEnabled, undefined);
  assert.equal(session.tabs[0].splitEnabled, true);
});

test('background title events update the owning split group and its correct side', () => {
  const first = splitTab('first');
  const second = splitTab('second');
  let tabs = applyTabStatus([first, second], { ...tabPageView(first, 'secondary'),
    url: 'https://www.youtube.com/watch?v=test', title: 'Video title - YouTube', isLoading: false });
  tabs = applyTabStatus(tabs, { tabId: 'first', pane: 'primary', title: 'Google Search' });
  assert.equal(tabs[0].title, 'Google Search');
  assert.equal(tabs[0].split.title, 'Video title - YouTube');
  assert.equal(tabs[0].split.url, 'https://www.youtube.com/watch?v=test');
  assert.equal(tabs[1], second);
  assert.equal(tabs[1].split.title, 'YouTube');
});

test('same-document video navigation follows the owning pane and is retained when reopening', () => {
  const paired = splitTab('youtube-pair', 'https://www.youtube.com/');
  const normal = createTab('foreground');
  let session = { tabs: [paired, normal], activeTabId: 'foreground' };
  const view = tabPageView(paired, 'secondary');
  for (const [url, canGoBack, canGoForward] of [
    ['https://www.youtube.com/watch?v=first', true, false],
    ['https://www.youtube.com/watch?v=second&list=mix', true, false],
    ['https://www.youtube.com/watch?v=second&list=mix&t=30s', true, false],
    ['https://www.youtube.com/watch?v=first', true, true],
  ]) {
    session = { ...session, tabs: applyTabStatus(session.tabs, {
      ...view, url, isLoading: null, canGoBack, canGoForward,
    }) };
    assert.equal(session.tabs[0].split.url, url);
    assert.equal(session.tabs[0].split.inputUrl, url);
    assert.equal(session.tabs[0].split.isLoading, false);
    assert.equal(session.tabs[0].split.canGoBack, canGoBack);
    assert.equal(session.tabs[0].split.canGoForward, canGoForward);
    assert.equal(session.tabs[0].url, paired.url);
    assert.equal(session.tabs[1], normal);
    assert.equal(session.activeTabId, normal.id);
  }
  session = reopenTab(closeTab(session, paired.id));
  assert.equal(session.tabs[0].split.url, 'https://www.youtube.com/watch?v=first');
});

test('disabling split separates both pages beside each other and clears the pairing', () => {
  const first = splitTab('first');
  const second = splitTab('second');
  const session = toggleSessionSplit({ tabs: [first, second], activeTabId: 'first' });
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['first', 'first-right', 'second']);
  assert.deepEqual(session.tabs.map((tab) => tab.title), ['Google', 'YouTube', 'Google']);
  assert.equal(session.activeTabId, 'first');
  assert.equal(session.tabs[0].split, undefined);
  assert.equal(session.tabs[0].splitEnabled, undefined);
  assert.equal(session.tabs[1].split, undefined);
  assert.equal(session.tabs[1].splitEnabled, undefined);
  assert.equal(session.tabs[2], second);
  assert.deepEqual(tabViews(session.tabs[0]), [tabPageView(first, 'primary')]);
  assert.deepEqual(tabViews(session.tabs[1]), [tabPageView(first, 'secondary')]);
  const enabled = toggleSessionSplit(session);
  assert.equal(enabled.tabs.length, 3);
  assert.equal(enabled.tabs[0].splitEnabled, true);
  assert.notEqual(enabled.tabs[0].split.id, first.split.id);
  assert.notDeepEqual(tabPageView(enabled.tabs[0], 'secondary'), tabPageView(session.tabs[1], 'primary'));
  assert.equal(enabled.tabs[1], session.tabs[1]);
});

test('closing a split group selects another tab and ignores late page events', () => {
  const paired = splitTab('pair');
  const normal = createTab('normal');
  const session = closeTab({ tabs: [normal, paired], activeTabId: 'pair' }, 'pair');
  assert.equal(session.activeTabId, 'normal');
  assert.deepEqual(session.tabs, [normal]);
  assert.equal(applyTabStatus(session.tabs, { tabId: 'pair', pane: 'secondary', title: 'Late title' }), session.tabs);
  assert.equal(closeTab(session, 'normal'), session);
});

test('closing either split page keeps the other native page alive, even in the last or swapped tab', () => {
  for (const pane of ['primary', 'secondary']) for (const reversed of [false, true]) for (const legacy of [false, true]) {
    const pair = { ...splitTab('pair'), splitReversed: reversed, splitRatio: 0.65, canGoBack: true };
    pair.split.canGoForward = true;
    if (legacy) delete pair.split.view;
    const survivorPane = pane === 'primary' ? 'secondary' : 'primary';
    const survivor = survivorPane === 'primary' ? pair : pair.split;
    const survivingView = tabPageView(pair, survivorPane);
    const closedView = tabPageView(pair, pane);
    const session = closeTabPage({ tabs: [pair], activeTabId: pair.id }, pair.id, pane);
    assert.equal(session.tabs.length, 1);
    assert.equal(session.activeTabId, survivor.id);
    assert.equal(session.tabs[0].url, survivor.url);
    assert.equal(session.tabs[0].title, survivor.title);
    assert.equal(session.tabs[0].canGoBack, survivor.canGoBack);
    assert.equal(session.tabs[0].canGoForward, survivor.canGoForward);
    assert.equal(session.tabs[0].isLoading, false);
    assert.deepEqual(tabViews(session.tabs[0]), [survivingView]);
    for (const field of ['split', 'splitEnabled', 'splitReversed', 'splitRatio']) assert.equal(session.tabs[0][field], undefined);
    assert.equal(applyTabStatus(session.tabs, { ...closedView, title: 'Late closed-page update' }), session.tabs);
    assert.equal(applyTabStatus(session.tabs, { ...survivingView, title: 'Still playing' })[0].title, 'Still playing');
    const reopened = reopenTab(session);
    const restored = reopened.tabs.find((tab) => tab.id === reopened.activeTabId);
    assert.equal(restored.url, pane === 'primary' ? pair.url : pair.split.url);
    assert.equal(restored.splitEnabled, undefined);
    assert.deepEqual(tabViews(reopened.tabs.find((tab) => tab.id === survivor.id)), [survivingView]);
  }
});

test('closing a background split page preserves the selected tab and its position', () => {
  const before = createTab('before');
  const pair = splitTab('pair');
  const after = createTab('after');
  const session = closeTabPage({ tabs: [before, pair, after], activeTabId: after.id }, pair.id, 'primary');
  assert.deepEqual(session.tabs.map((tab) => tab.id), [before.id, pair.split.id, after.id]);
  assert.equal(session.activeTabId, after.id);
  assert.equal(session.tabs[0], before);
  assert.equal(session.tabs[2], after);
});

test('swapping reverses both titles and pages while preserving their identities and histories', () => {
  const original = splitTab('pair');
  original.canGoBack = true;
  original.split.canGoForward = true;
  const swapped = swapTabPages(original);
  const pages = orderedTabPages(swapped);
  assert.deepEqual(pages.map(({ page }) => page.title), ['YouTube', 'Google']);
  assert.deepEqual(pages.map(({ pane }) => pane), ['secondary', 'primary']);
  assert.equal(pages[0].page, original.split);
  assert.equal(pages[0].page.canGoForward, true);
  assert.equal(pages[1].page.canGoBack, true);
  assert.equal(swapped.id, original.id);
  assert.deepEqual(orderedTabPages(swapTabPages(swapped)).map(({ page }) => page.title), ['Google', 'YouTube']);
  const single = createTab('single');
  assert.equal(swapTabPages(single), single);
});

test('separating swapped pages follows visual order and keeps their histories and events', () => {
  const swapped = swapTabPages(splitTab('pair'));
  swapped.canGoBack = true;
  swapped.split.canGoForward = true;
  let session = addTab({ tabs: [swapped], activeTabId: 'pair' }, createTab('other'));
  session.tabs = applyTabStatus(session.tabs, { tabId: 'pair', pane: 'primary', title: 'Updated Google' });
  session = selectTab(session, 'pair');
  assert.deepEqual(orderedTabPages(session.tabs[0]).map(({ page }) => page.title), ['YouTube', 'Updated Google']);
  session = toggleSessionSplit(session);
  assert.deepEqual(session.tabs.map((tab) => tab.title), ['YouTube', 'Updated Google', 'Google']);
  assert.equal(session.activeTabId, 'pair-right');
  assert.equal(session.tabs[0].canGoForward, true);
  assert.equal(session.tabs[1].canGoBack, true);
  session.tabs = applyTabStatus(session.tabs, { ...tabPageView(swapped, 'secondary'), title: 'Video changed', canGoBack: true });
  session.tabs = applyTabStatus(session.tabs, { ...tabPageView(swapped, 'primary'), title: 'Search changed' });
  assert.equal(session.tabs[0].title, 'Video changed');
  assert.equal(session.tabs[0].canGoBack, true);
  assert.equal(session.tabs[1].title, 'Search changed');
  const closed = closeTab(session, 'pair');
  assert.equal(closed.tabs[0].title, 'Video changed');
  assert.equal(applyTabStatus(closed.tabs, { tabId: 'pair', pane: 'primary', title: 'Late' }), closed.tabs);
});

test('legacy secondary views stay attached to their page when separated and split again', () => {
  const paired = splitTab('legacy');
  delete paired.split.view;
  const session = separateTabSplit({ tabs: [paired], activeTabId: paired.id }, paired.id);
  assert.deepEqual(tabPageView(session.tabs[1], 'primary'), { tabId: 'legacy', pane: 'secondary' });
  const selected = selectTab(session, session.tabs[1].id);
  const resplit = toggleSessionSplit(selected);
  const secondary = resplit.tabs[1];
  assert.deepEqual(tabPageView(secondary, 'primary'), { tabId: 'legacy', pane: 'secondary' });
  assert.notDeepEqual(tabPageView(secondary, 'primary'), tabPageView(secondary, 'secondary'));
  const updated = applyTabStatus(resplit.tabs, { tabId: 'legacy', pane: 'secondary', title: 'Updated video' });
  assert.equal(updated[1].title, 'Updated video');
  assert.equal(updated[0].title, 'Google');
});

test('repeated splits produce distinct tabs and never recall a detached page', () => {
  let session = { tabs: [createTab('start')], activeTabId: 'start' };
  for (let i = 0; i < 4; i++) {
    session = toggleSessionSplit(session);
    session = toggleSessionSplit(session);
  }
  assert.equal(session.tabs.length, 5);
  assert.equal(new Set(session.tabs.map((tab) => tab.id)).size, 5);
  assert.equal(new Set(session.tabs.flatMap(tabViews).map((view) => `${view.tabId}:${view.pane}`)).size, 5);
  assert.ok(session.tabs.every((tab) => !tab.split && !tab.splitEnabled && !tab.splitReversed));
});

test('the tab strip renders both real page titles as one linked split tab', () => {
  const componentUrl = new URL('../src/components/TabBar.tsx', import.meta.url);
  const compiled = ts.transpileModule(readFileSync(componentUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const require = createRequire(componentUrl);
  const icons = new Proxy({}, { get: () => (props) => React.createElement('svg', props) });
  // Render the real tab strip while keeping icon loading independent of Vite.
  const requireComponent = (name) => name === 'lucide-react' ? icons
    : name === '../lib/tabContextMenu' ? tabMenu
    : name === '../lib/tabState' ? { orderedTabPages }
    : name === '../hooks/useTabReorder' ? { useTabReorder: () => ({ draggedTabId: null, stripEvents: {}, onPointerDown() {} }) }
    : name === '../hooks/useTabSizing' ? { useTabSizing: () => ({ widths: {} }) }
    : name === './TabOverflow' ? { TabOverflow: () => null }
    : name === './TabContextMenu' ? { TabContextMenu: () => null }
    : name === './SiteIcon' ? { SiteIcon: ({ fallback }) => fallback }
    : require(name);
  new Function('require', 'exports', 'module', compiled)(requireComponent, module.exports, module);
  const html = renderToStaticMarkup(React.createElement(module.exports.TabBar, {
    tabs: [splitTab('pair'), createTab('normal')], activeTabId: 'pair',
    onSelectTab() {}, onCloseTab() {}, onNewTab() {}, onSwapTabPages() {}, onMoveTab() {},
  }));
  assert.match(html, /Google \| YouTube \(Split view\)/);
  assert.match(html, /Linked split pages/);
  assert.match(html, /Close split tab/);
  assert.equal((html.match(/Linked split pages/g) || []).length, 1);
  assert.match(html, /Swap left and right pages/);
  assert.match(html, /group-hover\/swap:opacity-100/);
  const swappedHtml = renderToStaticMarkup(React.createElement(module.exports.TabBar, {
    tabs: [swapTabPages(splitTab('pair'))], activeTabId: 'pair',
    onSelectTab() {}, onCloseTab() {}, onNewTab() {}, onSwapTabPages() {}, onMoveTab() {},
  }));
  assert.match(swappedHtml, /YouTube \| Google \(Split view\)/);
});
