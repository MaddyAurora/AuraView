import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as sizing from '../src/lib/tabSizing.ts';
import * as tabState from '../src/lib/tabState.ts';
import * as tabMenu from '../src/lib/tabContextMenu.ts';

function load(path, mocks) {
  const url = new URL(path, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const require = createRequire(url);
  new Function('require', 'module', 'exports', compiled)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const icons = new Proxy({}, { get: () => (props) => React.createElement('svg', props) });

test('overflow reserves its own space and shows only complete tab groups at every width', () => {
  const groups = Array.from({ length: 24 }, (_, index) => ({ id: String(index), preferred: index % 3 === 1 ? [176, 176] : [112] }));
  for (let available = 60; available <= 4000; available += 13) {
    const fit = sizing.fitTabGroups(groups, available);
    assert.equal(fit.hiddenCount + fit.visibleCount, groups.length);
    assert.equal(fit.widths.length, groups.slice(0, fit.visibleCount).reduce((sum, group) => sum + group.preferred.length, 0));
    assert.ok(fit.stripWidth + fit.counterWidth <= available + 0.001);
    assert.ok(fit.widths.every((width) => width >= 80 && width <= 176));
    if (fit.hiddenCount) {
      const nextMinimum = groups.slice(0, fit.visibleCount + 1)
        .reduce((sum, group) => sum + group.preferred.length * 80 + 4, 0);
      assert.ok(nextMinimum + sizing.overflowButtonWidth(fit.hiddenCount - 1) > available);
    }
  }
  assert.deepEqual(sizing.fitTabGroups([], 0).widths, []);
});

test('the counter appears only after shrinking is exhausted and grows for extra digits', () => {
  const groups = Array.from({ length: 10 }, (_, i) => ({ id: String(i), preferred: [176] }));
  const exact = sizing.fitTabGroups(groups, 840);
  assert.equal(exact.visibleCount, 10);
  assert.equal(exact.hiddenCount, 0);
  assert.deepEqual(exact.widths, Array(10).fill(80));
  const overflow = sizing.fitTabGroups(groups, 839);
  assert.equal(overflow.visibleCount, 9);
  assert.equal(overflow.hiddenCount, 1);
  assert.equal(sizing.overflowButtonWidth(10) - sizing.overflowButtonWidth(9), 8);
  assert.equal(sizing.overflowButtonWidth(100) - sizing.overflowButtonWidth(99), 8);
  assert.equal(sizing.fitTabGroups(groups, 2000).hiddenCount, 0);
});

test('the tab strip hides both linked cards together and displays the exact extra-tab count', () => {
  const TabOverflow = load('../src/components/TabOverflow.tsx', {
    'lucide-react': icons, '../lib/tabState': tabState, '../lib/tabSizing': sizing,
  }).TabOverflow;
  const TabBar = load('../src/components/TabBar.tsx', {
    '../lib/tabContextMenu': tabMenu,
    'lucide-react': icons, '../lib/tabState': tabState, './TabOverflow': { TabOverflow },
    './TabContextMenu': { TabContextMenu: () => null },
    '../hooks/useTabReorder': { useTabReorder: () => ({ draggedTabId: null, stripEvents: {}, onPointerDown() {} }) },
    '../hooks/useTabSizing': { useTabSizing: () => ({ widths: {}, visibleCount: 1, stripWidth: 100 }) },
  }).TabBar;
  const pair = tabState.enableTabSplit(tabState.createTab('pair'), 'right');
  const html = renderToStaticMarkup(React.createElement(TabBar, {
    tabs: [tabState.createTab('first'), pair, tabState.createTab('third')], activeTabId: 'pair',
    onSelectTab() {}, onCloseTab() {}, onNewTab() {}, onSwapTabPages() {}, onMoveTab() {},
  }));
  assert.equal((html.match(/data-tab-overflow="true"/g) || []).length, 3);
  assert.equal((html.match(/display:none/g) || []).length, 3);
  assert.match(html, /aria-label="2 more tabs"/);
  assert.match(html, /data-tab-overflowing="true"/);
});

test('right-click targets the exact background split page, even if detached before selection', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { __TAURI_INTERNALS__: {}, addEventListener() {}, removeEventListener() {} };
  let cursor = 0;
  const slots = [], cleanups = [], calls = [], closed = [], selected = [];
  const events = new Map();
  const hooks = { ...React,
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value;
      return [slots[index], (next) => { slots[index] = next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(fn) { const index = cursor++; if (!slots[index]) { slots[index] = true; cleanups.push(fn()); } },
  };
  const TabBar = load('../src/components/TabBar.tsx', {
    '../lib/tabContextMenu': tabMenu,
    react: hooks, 'lucide-react': icons, '../lib/tabState': tabState,
    './TabOverflow': { TabOverflow: () => null }, './TabContextMenu': { TabContextMenu: () => null },
    '../hooks/useTabReorder': { useTabReorder: () => ({ draggedTabId: null, stripEvents: {}, onPointerDown() {} }) },
    '../hooks/useTabSizing': { useTabSizing: () => ({ widths: {} }) },
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args }); return false; } },
    '@tauri-apps/api/event': { listen: async (name, handler) => { events.set(name, handler); return () => events.delete(name); } },
  }).TabBar;
  let pair = tabState.swapTabPages(tabState.enableTabSplit(tabState.createTab('pair'), 'right'));
  const foreground = tabState.createTab('foreground');
  const props = { tabs: [pair, foreground], activeTabId: foreground.id, onSelectTab: (id) => selected.push(id),
    canReopenTab: false, onTabMenuAction(action, pageId) {
      const target = tabState.findTabPage(props.tabs, pageId);
      if (action === 'close' && target) closed.push([target.owner.id, target.pane]);
    },
    onCloseTab() {}, onCloseTabPage: (...args) => closed.push(args), onNewTab() {}, onSwapTabPages() {}, onMoveTab() {} };
  const pages = (node, found = new Map()) => {
    if (!React.isValidElement(node)) return found;
    if (node.props['data-tab-page']) found.set(node.props['data-tab-page'], node.props);
    React.Children.forEach(node.props.children, (child) => pages(child, found));
    return found;
  };
  const render = () => { cursor = 0; return pages(TabBar(props)); };
  const event = { clientX: 210, clientY: 22, preventDefault() {}, stopPropagation() {} };
  try {
    let cards = render();
    await new Promise((resolve) => setImmediate(resolve));
    calls.length = 0;
    cards.get('right').onContextMenu(event);
    assert.deepEqual(calls, [{ command: 'show_tab_context_menu', args: { pageId: 'right', x: 210, y: 22, canClose: true,
      canCloseLeft: false, canCloseRight: true, canReopen: false, isMuted: false } }]);
    assert.deepEqual(selected, []);
    assert.deepEqual(closed, []);
    events.get('tab-context-action')({ payload: { action: 'close', pageId: 'right' } });
    assert.deepEqual(closed.pop(), ['pair', 'secondary']);
    cards.get('pair').onContextMenu(event);
    events.get('tab-context-action')({ payload: { action: 'close', pageId: 'pair' } });
    assert.deepEqual(closed.pop(), ['pair', 'primary']);
    // Native menu events are delivered asynchronously, after popup dismissal.
    props.tabs = tabState.separateTabSplit({ tabs: props.tabs, activeTabId: props.activeTabId }, pair.id).tabs;
    render();
    events.get('tab-context-action')({ payload: { action: 'close', pageId: 'right' } });
    assert.deepEqual(closed.pop(), ['right', 'primary']);
    events.get('tab-context-action')({ payload: { action: 'close', pageId: 'already-closed' } });
    assert.deepEqual(closed, []);
    props.tabs = [foreground]; cards = render(); calls.length = 0;
    cards.get(foreground.id).onContextMenu(event);
    assert.equal(calls[0].args.canClose, false);
    props.tabs = [pair]; cards = render(); calls.length = 0;
    cards.get('right').onContextMenu(event);
    assert.equal(calls[0].args.canClose, true);
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.size, 0);
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('preview context menu closes the chosen page and stays within the window', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = { innerWidth: 800, innerHeight: 600 };
  globalThis.document = { body: {} };
  const closed = [], dismissed = [];
  try {
    const TabContextMenu = load('../src/components/TabContextMenu.tsx', {
      '../lib/tabContextMenu': tabMenu,
      react: { ...React, useEffect() {}, useRef: (value) => ({ current: value }) },
      'react-dom': { createPortal: (node) => node },
    }).TabContextMenu;
    const menu = TabContextMenu({ target: { pageId: 'clicked', x: 799, y: 599, canClose: true,
      canCloseLeft: false, canCloseRight: true, canReopen: false, isMuted: true },
      onAction: (action, id) => closed.push([action, id]), onDismiss: () => dismissed.push(true) });
    assert.deepEqual(menu.props.style, { left: 576, top: 314, maxWidth: '100vw', maxHeight: '100vh' });
    const buttons = menu.props.children.map((group) => group.props.children[1]);
    assert.deepEqual(buttons.map((button) => button.props.children), [
      'Refresh', 'Duplicate tab', 'Unmute tab', 'Close page', 'Close tabs to the right', 'Close tabs to the left', 'Reopen closed tab',
    ]);
    assert.deepEqual(buttons.map((button) => button.props.disabled), [false, false, false, false, false, true, true]);
    buttons[3].props.onClick();
    assert.deepEqual(closed, [['close', 'clicked']]);
    assert.deepEqual(dismissed, [true]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('hover and click share one native popup, list only extra tabs, and select through its event', async () => {
  const previousWindow = globalThis.window;
  const previousTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  let scheduled, cursor = 0, tree, resolvePopup;
  const slots = [], cleanups = [], calls = [], selected = [];
  const events = new Map();
  globalThis.setTimeout = (fn) => { scheduled = fn; return 1; };
  globalThis.clearTimeout = () => { scheduled = undefined; };
  const hooks = { ...React,
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value;
      return [slots[index], (next) => { slots[index] = next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(fn) { const index = cursor++; if (!slots[index]) { slots[index] = true; cleanups.push(fn()); } },
  };
  const TabOverflow = load('../src/components/TabOverflow.tsx', {
    react: hooks, 'lucide-react': icons, '../lib/tabState': tabState, '../lib/tabSizing': sizing,
    '@tauri-apps/api/core': { invoke: (command, args) => { calls.push({ command, args }); return new Promise((resolve) => { resolvePopup = resolve; }); } },
    '@tauri-apps/api/event': { listen: async (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
  }).TabOverflow;
  const pair = tabState.enableTabSplit(tabState.createTab('pair'), 'right');
  pair.title = 'Left page'; pair.split.title = 'Right page'; pair.splitReversed = true;
  const props = { tabs: [pair, tabState.createTab('extra')], activeTabId: 'pair', onSelect: (id) => selected.push(id) };
  const render = () => {
    cursor = 0; tree = TabOverflow(props);
    const button = tree.props.children[0];
    button.ref.current = { getBoundingClientRect: () => ({ left: 950, bottom: 38 }) };
    return button;
  };
  try {
    let button = render();
    await new Promise((resolve) => setImmediate(resolve));
    button.props.onMouseEnter(); assert.equal(typeof scheduled, 'function');
    const enter = scheduled; enter();
    button = render();
    assert.equal(button.props['aria-expanded'], true);
    button.props.onClick(); // A click following hover must not open another popup.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { command: 'show_tab_overflow', args: {
      tabs: [{ id: 'pair', title: 'Right page | Left page' }, { id: 'extra', title: 'Google' }],
      activeTabId: 'pair', x: 950, y: 40,
    } });
    events.get('tab-overflow-select')({ payload: 'extra' });
    assert.deepEqual(selected, ['extra']);
    resolvePopup(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(render().props['aria-expanded'], false);
    button.props.onMouseEnter(); assert.equal(scheduled, undefined); // No dismissal/reopen loop.
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.size, 0);
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.setTimeout = previousTimeout; globalThis.clearTimeout = previousClearTimeout;
  }
});
