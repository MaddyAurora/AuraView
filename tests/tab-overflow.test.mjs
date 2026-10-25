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
import * as overflow from '../src/lib/tabOverflow.ts';

function load(path, mocks) {
  mocks['./SiteIcon'] ||= { SiteIcon: ({ fallback }) => fallback };
  mocks['../lib/tabOverflow'] ||= overflow;
  mocks['./TabOverflowMenu'] ||= { TabOverflowMenu: () => null };
  mocks['../hooks/useMenuAutoClose'] ||= { useMenuAutoClose: () => ({ ref: undefined, onMouseEnter() {}, onMouseLeave() {}, onKeyDown() {} }) };
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
    assert.ok(fit.widths.every((width) => width >= 24 && width <= 176));
    if (fit.hiddenCount) {
      const nextMinimum = groups.slice(0, fit.visibleCount + 1)
        .reduce((sum, group) => sum + group.preferred.length * 24 + 4, 0);
      assert.ok(nextMinimum + sizing.overflowButtonWidth(fit.hiddenCount - 1) > available);
    }
  }
  assert.deepEqual(sizing.fitTabGroups([], 0).widths, []);
});

test('the counter appears only after shrinking is exhausted and grows for extra digits', () => {
  const groups = Array.from({ length: 10 }, (_, i) => ({ id: String(i), preferred: [176] }));
  const exact = sizing.fitTabGroups(groups, 280);
  assert.equal(exact.visibleCount, 10);
  assert.equal(exact.hiddenCount, 0);
  assert.deepEqual(exact.widths, Array(10).fill(24));
  const overflow = sizing.fitTabGroups(groups, 279);
  assert.equal(overflow.visibleCount, 8);
  assert.equal(overflow.hiddenCount, 2);
  assert.equal(sizing.overflowButtonWidth(10) - sizing.overflowButtonWidth(9), 8);
  assert.equal(sizing.overflowButtonWidth(100) - sizing.overflowButtonWidth(99), 8);
  assert.equal(sizing.fitTabGroups(groups, 2000).hiddenCount, 0);
});

test('favicon-sized tabs reclaim the brand label before the overflow counter appears', () => {
  const groups = Array.from({ length: 10 }, (_, i) => ({ id: String(i), preferred: [176] }));
  const withTitle = sizing.fitTabBar(groups, 340, 60);
  assert.equal(withTitle.hideTitle, false);
  assert.equal(withTitle.hiddenCount, 0);
  assert.deepEqual(withTitle.widths, Array(10).fill(24));
  const reclaimed = sizing.fitTabBar(groups, 339, 60);
  assert.equal(reclaimed.hideTitle, true);
  assert.equal(reclaimed.hiddenCount, 0);
  const exact = sizing.fitTabBar(groups, 280, 60);
  assert.equal(exact.hideTitle, true);
  assert.deepEqual(exact.widths, Array(10).fill(24));
  const overflow = sizing.fitTabBar(groups, 279, 60);
  assert.equal(overflow.hideTitle, true);
  assert.equal(overflow.hiddenCount, 2);
  assert.ok(overflow.stripWidth + overflow.counterWidth <= 279);
  assert.equal(sizing.fitTabBar(groups, 600, 60).hideTitle, false);
  assert.equal(sizing.fitTabBar(groups.slice(0, 7), 279, 60).hideTitle, false);
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
  const slots = [], cleanups = [], calls = [], selected = [], closedTabs = [];
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
  const props = { tabs: [pair, tabState.createTab('extra')], activeTabId: 'pair', onSelect: (id) => selected.push(id),
    onCloseTab: (id) => closedTabs.push(id) };
  const render = () => {
    cursor = 0; tree = TabOverflow(props);
    const button = tree.props.children[0];
    button.ref.current = { getBoundingClientRect: () => ({ left: 950, top: 6, width: 36, height: 32, bottom: 38 }), focus() {} };
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
      tabs: overflow.overflowEntries(props.tabs),
      activeTabId: 'pair', anchor: { x: 950, y: 6, width: 36, height: 32 },
    } });
    events.get('tab-overflow-select')({ payload: 'extra' });
    assert.deepEqual(selected, ['extra']);
    events.get('tab-overflow-close-tab')({ payload: 'pair' });
    events.get('tab-overflow-close-tab')({ payload: 'already-closed' });
    assert.deepEqual(closedTabs, ['pair']);
    assert.deepEqual(selected, ['extra'], 'closing an overflow tab does not select it');
    resolvePopup(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(render().props['aria-expanded'], true, 'the popup stays open after its creation command returns');
    events.get('tab-overflow-select')({ payload: 'already-closed' });
    assert.deepEqual(selected, ['extra']);
    events.get('tab-overflow-closed')({ payload: { restoreFocus: true } });
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

test('the styled menu preserves linked pages, icons and literal titles, and scrolls keyboard selections into view', () => {
  const previousDocument = globalThis.document;
  const effects = [], focused = [], scrolled = [], selected = [], closed = [], closedTabs = [];
  const tabs = Array.from({ length: 100 }, (_, i) => tabState.createTab(`tab-${i}`));
  tabs[0].title = '<Music & video>';
  tabs[0].favicon = 'https://untrusted.example/favicon.svg';
  tabs[1] = tabState.swapTabPages(tabState.enableTabSplit(tabs[1], 'right-page'));
  tabs[1].split.isMuted = true;
  const entries = overflow.overflowEntries(tabs);
  assert.equal(entries[0].favicon, undefined);
  assert.equal(entries[0].pages[0].favicon, undefined);
  assert.equal(entries[1].pages[0].url, tabs[1].split.url);
  assert.equal(overflow.overflowPageLabel({ url: 'file:///B:/page.html' }), 'Local file');
  const items = entries.map((entry, index) => ({ dataset: { tabId: entry.id },
    focus() { globalThis.document.activeElement = this; focused.push(index); },
    scrollIntoView(options) { scrolled.push([index, options]); },
  }));
  const list = { querySelectorAll: () => items, contains: (node) => items.includes(node) };
  globalThis.document = { activeElement: null };
  try {
    const Menu = load('../src/components/TabOverflowMenu.tsx', {
      react: { useRef: () => ({ current: list }), useLayoutEffect: (fn) => effects.push(fn) },
      'lucide-react': icons,
    }).TabOverflowMenu;
    const props = { entries, activeTabId: 'tab-70', onSelect: (id) => selected.push(id), onClose: () => closed.push(true),
      onCloseTab: (id) => closedTabs.push(id) };
    const tree = Menu(props);
    effects.pop()();
    assert.deepEqual(focused, [70]);
    assert.deepEqual(scrolled, [[70, { block: 'nearest' }]]);
    const event = key => ({ key, preventDefault() {}, stopPropagation() {} });
    tree.props.onKeyDown(event('End'));
    assert.equal(focused.at(-1), 99);
    assert.deepEqual(scrolled.at(-1), [99, { block: 'nearest' }]);
    tree.props.onKeyDown(event('ArrowDown'));
    assert.equal(focused.at(-1), 0);
    tree.props.onKeyDown(event('ArrowUp'));
    assert.equal(focused.at(-1), 99);
    tree.props.onKeyDown(event('Home'));
    assert.equal(focused.at(-1), 0);
    tree.props.children[1].props.children[99].props.onClick();
    assert.deepEqual(selected, ['tab-99']);
    const pointer = button => ({ button, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    const down = pointer(1);
    tree.props.onMouseDown(down);
    assert.equal(down.prevented, true, 'prevent middle-button autoscroll at mouse-down');
    assert.deepEqual(closedTabs, [], 'wait for the completed click before closing');
    const middle = pointer(1);
    tree.props.children[1].props.children[98].props.onAuxClick(middle);
    assert.equal(middle.prevented, true); assert.equal(middle.stopped, true);
    assert.deepEqual(closedTabs, ['tab-98']);
    assert.deepEqual(selected, ['tab-99']);
    assert.deepEqual(closed, [], 'keep the menu available for closing additional tabs');
    for (const button of [0, 2]) tree.props.children[1].props.children[98].props.onAuxClick(pointer(button));
    const emptySpace = pointer(1);
    tree.props.onAuxClick(emptySpace);
    assert.equal(emptySpace.prevented, true);
    assert.deepEqual(closedTabs, ['tab-98']);
    tree.props.onKeyDown(event('Escape'));
    assert.deepEqual(closed, [true]);
    Menu(props); effects.pop()();
    assert.equal(focused.length, 5, 'background updates preserve a focused row and its scroll position');
    const html = renderToStaticMarkup(tree);
    assert.match(html, /overflow-y-auto/);
    assert.match(html, /&lt;Music &amp; video&gt;/);
    assert.match(html, /Linked split pages/);
    assert.match(html, /Tab muted/);
    assert.equal((html.match(/role="menuitemradio"/g) || []).length, 100);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
