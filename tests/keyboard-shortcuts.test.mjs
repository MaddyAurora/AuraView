import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import * as tabState from '../src/lib/tabState.ts';
import * as shortcuts from '../src/lib/shortcuts.ts';

// Run App's real handlers and effects with native invocations/events stubbed.
async function harness() {
  const originals = { window: globalThis.window, HTMLElement: globalThis.HTMLElement };
  const listeners = new Map();
  const native = new Map();
  const calls = [];
  const slots = [];
  let cursor = 0, dirty = false, effects = [], tree;
  class Element { constructor(control = false) { this.control = control; } closest() { return this.control; } }
  globalThis.HTMLElement = Element;
  globalThis.window = { __TAURI_INTERNALS__: {},
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
  const hooks = {
    ...React, default: React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const components = new Map();
  const require = (name) => {
    if (name === 'react') return hooks;
    if (name === './lib/tabState') return tabState;
    if (name === './lib/shortcuts') return shortcuts;
    if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => { calls.push({ command, args }); } };
    if (name === '@tauri-apps/api/event') return { listen: async (name, fn) => {
      native.set(name, fn); return () => { if (native.get(name) === fn) native.delete(name); };
    } };
    if (name === './components/VideoDownloads') return { VideoDownloads: () => null, useVideoDownloads: () => [], downloadBusy: () => false };
    if (name.startsWith('./components/')) {
      const key = name.split('/').pop(), component = () => null;
      components.set(key, component); return { [key]: component };
    }
    assert.fail(`Unexpected import: ${name}`);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const h = {
    calls, Element,
    get session() { return slots[0]; },
    get tabBar() { return tree.props.children[0].props; },
    get bookmarks() { return tree.props.children.find((child) => child?.type === components.get('BookmarksBar')).props; },
    get webviews() { return tree.props.children.find((child) => child?.type === components.get('WebviewContainer')).props; },
    setSession(session) { slots[0] = session; dirty = true; },
    flush() {
      do {
        cursor = 0; effects = []; dirty = false;
        tree = module.exports.App(); effects.forEach((fn) => fn());
      } while (dirty);
    },
    key(key, mods = {}) {
      const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        target: new Element(), preventDefault() { this.defaultPrevented = true; }, ...mods };
      listeners.get('keydown')(event); h.flush(); return event;
    },
    event(name, payload) { native.get(name)?.({ payload }); h.flush(); },
    dispose() {
      slots.forEach((slot) => slot?.cleanup?.());
      assert.equal(native.size, 0);
      for (const [name, value] of Object.entries(originals)) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    },
  };
  h.flush();
  // Native listeners are installed asynchronously, like the actual Tauri API.
  await new Promise((resolve) => setImmediate(resolve));
  return h;
}

test('keyboard tab actions cycle, select numbers, close, and reopen in the real App', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 9; i++) h.key('t', { ctrlKey: true });
    const ids = h.session.tabs.map((tab) => tab.id);
    assert.equal(ids.length, 10);
    h.key('Tab', { ctrlKey: true }); assert.equal(h.session.activeTabId, ids[0]);
    h.key('Tab', { ctrlKey: true, shiftKey: true }); assert.equal(h.session.activeTabId, ids[9]);
    for (let i = 1; i <= 8; i++) {
      h.key(String(i), { ctrlKey: true }); assert.equal(h.session.activeTabId, ids[i - 1]);
    }
    h.key('9', { ctrlKey: true }); assert.equal(h.session.activeTabId, ids[9]);
    h.key('F4', { ctrlKey: true }); assert.equal(h.session.tabs.length, 9);
    assert.equal(h.calls.at(-1).command, 'close_browser_views');
    h.key('F4', { ctrlKey: true, shiftKey: true });
    assert.equal(h.session.tabs.length, 10);
    assert.notEqual(h.session.activeTabId, ids[9]);
    assert.equal(h.session.closedTabs.length, 0);
  } finally { h.dispose(); }
});

test('page shortcuts target the focused split pane from the UI and native event source', async () => {
  const h = await harness();
  try {
    const pair = tabState.enableTabSplit(tabState.createTab('pair'), 'right');
    h.setSession({ tabs: [pair], activeTabId: 'pair' }); h.flush();
    const right = tabState.tabPageView(pair, 'secondary');
    h.event('browser-focus', right);
    for (const [key, modifiers, action] of [
      ['Escape', {}, 'stop'], ['f', { ctrlKey: true }, 'find'],
      ['g', { ctrlKey: true }, 'find-next'], ['G', { ctrlKey: true, shiftKey: true }, 'find-previous'],
      [' ', {}, 'scroll-down'], [' ', { shiftKey: true }, 'scroll-up'],
      ['p', { ctrlKey: true }, 'print'], ['s', { ctrlKey: true }, 'save'],
      ['F11', {}, 'fullscreen'], ['F12', {}, 'devtools'],
    ]) {
      assert.equal(h.key(key, modifiers).defaultPrevented, true);
      assert.deepEqual(h.calls.at(-1), { command: 'browser_page_action', args: { ...right, action } });
    }
    for (const key of ['F5', 'r']) {
      h.key(key, { ctrlKey: true });
      assert.deepEqual(h.calls.at(-1), { command: 'reload_browser_view', args: right });
    }
    const left = tabState.tabPageView(pair, 'primary');
    h.event('browser-shortcut', { action: 'save', view: left });
    assert.deepEqual(h.calls.at(-1).args, { ...left, action: 'save' });
    h.event('browser-shortcut', { action: 'new-tab', view: right });
    h.key('p', { ctrlKey: true });
    assert.deepEqual(h.calls.at(-1).args, { tabId: h.session.activeTabId, pane: 'primary', action: 'print' });
  } finally { h.dispose(); }
});

test('shortcuts preserve input/control spaces, composed text, handled events and unrelated modifiers', async () => {
  const h = await harness();
  try {
    for (const mods of [{ target: new h.Element(true) }, { isComposing: true }, { defaultPrevented: true }]) {
      h.key(' ', mods); assert.equal(h.calls.length, 0);
    }
    assert.equal(h.key('t', { ctrlKey: true, altKey: true }).defaultPrevented, undefined);
    assert.equal(h.key('T', { ctrlKey: true, shiftKey: true }).defaultPrevented, undefined);
    assert.equal(h.session.tabs.length, 1);
    h.key('8', { ctrlKey: true }); assert.equal(h.session.activeTabId, 'tab-1');
    h.key('F4', { ctrlKey: true }); assert.equal(h.session.tabs.length, 1);
  } finally { h.dispose(); }
});

test('bookmarks use the focused split page, ignore stale focus, and block browser shortcuts while editing', async () => {
  const h = await harness();
  try {
    const pair = tabState.enableTabSplit(tabState.createTab('pair', 'https://example.com/left'), 'right');
    pair.split = { ...pair.split, title: 'Right page', url: 'https://example.org/right' };
    h.setSession({ tabs: [pair], activeTabId: 'pair' }); h.flush();
    h.event('browser-focus', tabState.tabPageView(pair, 'secondary'));
    assert.equal(h.bookmarks.getCurrentPage().title, 'Right page');
    h.bookmarks.onOpen('https://example.org/saved'); h.flush();
    assert.deepEqual(h.calls.at(-1).args, { ...tabState.tabPageView(pair, 'secondary'), url: 'https://example.org/saved' });
    h.bookmarks.onDialogChange(true); h.flush();
    assert.equal('overlayOpen' in h.webviews, false);
    const callCount = h.calls.length;
    h.key('t', { ctrlKey: true });
    h.event('browser-shortcut', { action: 'close-tab' });
    h.event('browser-shortcut', { action: 'split' });
    assert.equal(h.session.tabs.length, 1);
    assert.equal(h.session.tabs[0].splitEnabled, true);
    assert.equal(h.calls.length, callCount);
    h.bookmarks.onDialogChange(false); h.flush();
    assert.equal('overlayOpen' in h.webviews, false);
    h.bookmarks.onOpen('https://example.net/new', true); h.flush();
    assert.equal(h.session.tabs.length, 2);
    assert.equal(h.bookmarks.getCurrentPage().url, 'https://example.net/new');
  } finally { h.dispose(); }
});

test('closing a split page from the tab bar retires only its native view', async () => {
  const h = await harness();
  try {
    for (const pane of ['primary', 'secondary']) {
      const pair = tabState.swapTabPages(tabState.enableTabSplit(tabState.createTab('pair'), 'right'));
      h.setSession({ tabs: [pair], activeTabId: pair.id }); h.flush();
      h.calls.length = 0;
      h.tabBar.onCloseTabPage(pair.id, pane, { stopPropagation() {} }); h.flush();
      assert.deepEqual(h.calls, [{ command: 'close_browser_views', args: { views: [tabState.tabPageView(pair, pane)] } }]);
      assert.equal(h.session.tabs.length, 1);
      assert.deepEqual(tabState.tabViews(h.session.tabs[0]), [tabState.tabPageView(pair, pane === 'primary' ? 'secondary' : 'primary')]);
    }
    h.calls.length = 0;
    h.tabBar.onCloseTabPage(h.session.activeTabId, 'primary', { stopPropagation() {} }); h.flush();
    assert.equal(h.session.tabs.length, 1);
    assert.deepEqual(h.calls, []);
  } finally { h.dispose(); }
});

test('reopening restores split URLs, order and ratio with fresh identities and bounded LIFO history', () => {
  const pair = { ...tabState.enableTabSplit(tabState.createTab('pair', 'https://example.com/left'), 'right'),
    splitReversed: true, splitRatio: 0.7 };
  pair.split.url = 'https://example.com/right';
  const other = tabState.createTab('other');
  const closed = tabState.closeTab({ tabs: [pair, other], activeTabId: 'pair' }, 'pair');
  const reopened = tabState.reopenTab(tabState.toggleSessionSplit(tabState.addTab(closed, tabState.createTab('new'))));
  assert.equal(reopened.tabs[0].url, pair.url);
  assert.equal(reopened.tabs[0].split.url, pair.split.url);
  assert.equal(reopened.tabs[0].splitReversed, true);
  assert.equal(reopened.tabs[0].splitRatio, 0.7);
  assert.notDeepEqual(tabState.tabViews(reopened.tabs[0]), tabState.tabViews(pair));
  assert.equal(reopened.tabs[0].canGoBack, false);
  let session = { tabs: Array.from({ length: 25 }, (_, i) => tabState.createTab(`t${i}`)), activeTabId: 't24' };
  for (let i = 24; i >= 1; i--) session = tabState.closeTab(session, `t${i}`);
  assert.equal(session.closedTabs.length, 20);
  assert.equal(tabState.reopenTab(session).closedTabs.length, 19);
  assert.equal(tabState.reopenTab({ tabs: [other], activeTabId: 'other' }).tabs[0], other);
});

test('tab menu refresh, mute and duplicate target a background split page without changing its partner', async () => {
  const h = await harness();
  try {
    const pair = tabState.swapTabPages(tabState.enableTabSplit(tabState.createTab('pair'), 'right'));
    pair.split = { ...pair.split, url: 'https://example.com/video', title: 'Video', canGoBack: true };
    const other = tabState.createTab('other');
    h.setSession({ tabs: [pair, other], activeTabId: 'other' }); h.flush();
    const view = tabState.tabPageView(pair, 'secondary');
    h.tabBar.onTabMenuAction('refresh', 'right'); h.flush();
    assert.deepEqual(h.calls.at(-1), { command: 'reload_browser_view', args: view });
    assert.equal(h.session.activeTabId, 'other');
    h.tabBar.onTabMenuAction('mute', 'right'); h.flush();
    assert.deepEqual(h.calls.at(-1), { command: 'set_browser_muted', args: { ...view, muted: true } });
    assert.equal(h.session.tabs[0].split.isMuted, true);
    assert.equal(h.session.tabs[0].isMuted, undefined);
    h.tabBar.onTabMenuAction('duplicate', 'right'); h.flush();
    const duplicate = h.session.tabs[1];
    assert.equal(duplicate.url, pair.split.url);
    assert.equal(duplicate.title, 'Video');
    assert.equal(duplicate.isMuted, true);
    assert.equal(duplicate.inputUrl, duplicate.url);
    assert.equal(duplicate.canGoBack, false);
    assert.equal(duplicate.split, undefined);
    assert.equal(duplicate.view, undefined);
    assert.notEqual(duplicate.id, 'right');
    assert.equal(h.session.activeTabId, duplicate.id);
    assert.equal(h.session.tabs[0].splitReversed, true);
    assert.equal(h.session.tabs[0].split.canGoBack, true);
    h.tabBar.onTabMenuAction('mute', 'right'); h.flush();
    assert.equal(h.session.tabs[0].split.isMuted, false);
    assert.equal(h.session.tabs[1].isMuted, true);
    const callCount = h.calls.length;
    h.tabBar.onTabMenuAction('refresh', 'already-closed'); h.flush();
    assert.equal(h.calls.length, callCount);
    h.setSession(tabState.separateTabSplit(h.session, 'pair')); h.flush();
    h.tabBar.onTabMenuAction('refresh', 'right'); h.flush();
    assert.deepEqual(h.calls.at(-1), { command: 'reload_browser_view', args: view });
  } finally { h.dispose(); }
});

test('directional tab closing keeps the clicked split group, retires every removed view, and reopens in order', async () => {
  const h = await harness();
  try {
    for (const side of ['left', 'right']) {
      const tabs = [tabState.createTab('left'), tabState.enableTabSplit(tabState.createTab('pair'), 'right-page'),
        tabState.enableTabSplit(tabState.createTab('other-pair'), 'other-right'), tabState.createTab('last')];
      const closing = side === 'left' ? tabs.slice(0, 1) : tabs.slice(2);
      h.setSession({ tabs, activeTabId: side === 'left' ? 'left' : 'last' }); h.flush();
      h.calls.length = 0;
      h.tabBar.onTabMenuAction(`close-${side}`, 'right-page'); h.flush();
      assert.deepEqual(h.calls, [{ command: 'close_browser_views', args: { views: closing.flatMap(tabState.tabViews) } }]);
      assert.ok(h.session.tabs.includes(tabs[1]));
      assert.ok(h.session.tabs.some((tab) => tab.id === h.session.activeTabId));
      assert.equal(h.tabBar.canReopenTab, true);
      for (const closed of closing) {
        h.tabBar.onTabMenuAction('reopen', 'right-page'); h.flush();
        const restored = h.session.tabs.find((tab) => tab.id === h.session.activeTabId);
        assert.equal(restored.url, closed.url);
        assert.equal(restored.splitEnabled, closed.splitEnabled);
        assert.notEqual(restored.id, closed.id);
      }
      assert.deepEqual(h.session.tabs.map((tab) => Boolean(tab.splitEnabled)), [false, true, true, false]);
      assert.equal(h.tabBar.canReopenTab, false);
    }
    const last = tabState.createTab('single');
    h.setSession({ tabs: [last], activeTabId: last.id }); h.flush(); h.calls.length = 0;
    for (const action of ['close-left', 'close-right', 'close', 'reopen']) {
      h.tabBar.onTabMenuAction(action, last.id); h.flush();
      assert.equal(h.session.tabs[0], last);
    }
    assert.deepEqual(h.calls, []);
  } finally { h.dispose(); }
});
