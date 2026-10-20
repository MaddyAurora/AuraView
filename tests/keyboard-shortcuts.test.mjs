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
  const require = (name) => {
    if (name === 'react') return hooks;
    if (name === './lib/tabState') return tabState;
    if (name === './lib/shortcuts') return shortcuts;
    if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => { calls.push({ command, args }); } };
    if (name === '@tauri-apps/api/event') return { listen: async (name, fn) => {
      native.set(name, fn); return () => { if (native.get(name) === fn) native.delete(name); };
    } };
    if (name.startsWith('./components/')) return { [name.split('/').pop()]: () => null };
    assert.fail(`Unexpected import: ${name}`);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const h = {
    calls, Element,
    get session() { return slots[0]; },
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
