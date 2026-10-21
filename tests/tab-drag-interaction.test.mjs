import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { createTab, enableTabSplit, moveTab, orderedTabPages } from '../src/lib/tabState.ts';
import { tabDragPlacement, tabDragScrollVelocity } from '../src/lib/tabDrag.ts';

// Exercise the real pointer handlers with a small DOM/hook harness. No browser
// or native app is launched, and page cards retain their identities on render.
function harness(tabs, widths = {}) {
  let session = { tabs, activeTabId: tabs[0].id };
  let api;
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let rafId = 0;
  const slots = [];
  const cleanups = [];
  const frames = new Map();
  const listeners = new Map();
  const cards = new Map();
  const selected = [];
  const moved = [];
  const captures = new Set();
  let scrollLeft = 0;
  const strip = {
    dataset: {},
    getAnimations: () => [],
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(value) { scrollLeft = Math.max(0, Math.min(1000, value)); },
    getBoundingClientRect: () => ({ left: 100, right: 500, width: 400 }),
    querySelectorAll: () => [...cards.values()].sort((a, b) => a.left - b.left),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const globals = { window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame, getComputedStyle: globalThis.getComputedStyle };
  globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    matchMedia: () => ({ matches: false }),
  };
  globalThis.requestAnimationFrame = (fn) => { frames.set(++rafId, fn); return rafId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.getComputedStyle = (card) => ({ marginRight: String(card.margin) });
  const hooks = {
    useRef(value) {
      const slot = cursor++;
      return slots[slot] ||= { current: value };
    },
    useState(value) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = value;
      return [slots[slot], (next) => { if (slots[slot] !== next) { slots[slot] = next; dirty = true; } }];
    },
    useLayoutEffect(fn) { cursor++; effects.push(fn); },
    useEffect(fn) {
      const slot = cursor++;
      if (!slots[slot]) { slots[slot] = true; effects.push(() => cleanups.push(fn())); }
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useTabReorder.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => name === 'react' ? hooks : name === '../lib/tabState' ? { orderedTabPages }
    : name === '../lib/tabDrag' ? { tabDragPlacement, tabDragScrollVelocity } : assert.fail(`Unexpected import: ${name}`);
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const ref = { current: strip };
  function render() {
    let left = 0;
    for (const tab of session.tabs) {
      const pages = tab.splitEnabled ? orderedTabPages(tab) : orderedTabPages(tab).slice(0, 1);
      pages.forEach(({ page }, index) => {
        let card = cards.get(page.id);
        if (!card) {
          card = { dataset: { tabPage: page.id }, style: {
            removeProperty(name) { delete this[name]; }, setProperty(name, value) { this[name] = value; } },
            getAnimations: () => [], animate: () => ({ playState: 'finished', cancel() {} }) };
          card.getBoundingClientRect = () => {
            const offset = parseFloat(card.style.transform?.match(/translateX\(([-.\d]+)/)?.[1] || '0');
            return { left: 100 + card.left - strip.scrollLeft + offset, width: widths[page.id] ?? 176 };
          };
          cards.set(page.id, card);
        }
        card.dataset.tabOwner = tab.id;
        card.left = left;
        card.margin = index < pages.length - 1 ? 0 : 4;
        left += (widths[page.id] ?? 176) + card.margin;
      });
    }
    dirty = false;
    cursor = 0;
    effects = [];
    api = module.exports.useTabReorder(ref, session.tabs,
      (id) => selected.push(id), (id, index) => { moved.push([id, index]); session = moveTab(session, id, index); dirty = true; });
    effects.forEach((fn) => fn());
  }
  render();
  const event = (x, button = false) => ({ clientX: x, pointerId: 1, isPrimary: true, button: 0,
    target: { closest: () => button }, preventDefault() {}, stopPropagation() {} });
  return {
    cards, strip, selected, moved, frames, captures,
    get api() { return api; }, get session() { return session; }, event,
    flush() { while (dirty) render(); },
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(16)); },
    escape() { listeners.get('keydown')?.({ key: 'Escape', preventDefault() {} }); },
    dispose() {
      cleanups.forEach((fn) => fn?.());
      for (const [name, value] of Object.entries(globals)) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    },
  };
}

test('overflow cards stay outside dragging and visible tabs keep their global order', () => {
  const h = harness(['a', 'b', 'c', 'd'].map((id) => createTab(id)));
  try {
    h.cards.get('c').dataset.tabOverflow = 'true';
    h.cards.get('d').dataset.tabOverflow = 'true';
    h.api.onPointerDown(h.event(350), 'b');
    h.api.stripEvents.onPointerMove(h.event(110));
    assert.equal(h.cards.get('c').style.transform, undefined);
    assert.equal(h.cards.get('d').style.transform, undefined);
    h.api.stripEvents.onPointerUp(h.event(110));
    h.flush();
    assert.deepEqual(h.session.tabs.map((tab) => tab.id), ['b', 'a', 'c', 'd']);
  } finally { h.dispose(); }
});

test('clicks and small pointer movements select normally without rearranging tabs', () => {
  const h = harness([createTab('a'), createTab('b')]);
  try {
    h.api.onPointerDown(h.event(300), 'b');
    h.api.stripEvents.onPointerMove(h.event(304));
    h.api.stripEvents.onPointerUp(h.event(304));
    h.flush();
    assert.deepEqual(h.selected, ['b']);
    assert.deepEqual(h.moved, []);
    assert.equal(h.frames.size, 0);
    assert.equal(h.captures.size, 0);
    h.api.onPointerDown(h.event(300, true), 'b');
    assert.deepEqual(h.selected, ['b']);
    assert.equal(h.captures.size, 0);
  } finally { h.dispose(); }
});

test('grabbing the right half moves both linked cards together and commits once on release', () => {
  const h = harness([createTab('a'), enableTabSplit(createTab('pair'), 'right'), createTab('c')]);
  try {
    const first = h.cards.get('pair');
    const second = h.cards.get('right');
    h.api.onPointerDown(h.event(500), 'pair');
    h.api.stripEvents.onPointerMove(h.event(800));
    h.flush();
    assert.equal(first.style.transform, 'translateX(180px)');
    assert.equal(second.style.transform, first.style.transform);
    assert.equal(first.dataset.tabDragging, 'true');
    assert.equal(second.dataset.tabDragging, 'true');
    assert.deepEqual(h.moved, []);
    h.api.stripEvents.onPointerUp(h.event(800));
    h.flush();
    assert.deepEqual(h.moved, [['pair', 2]]);
    assert.deepEqual(h.session.tabs.map((tab) => tab.id), ['a', 'c', 'pair']);
    assert.equal(h.cards.get('pair'), first);
    assert.equal(h.cards.get('right'), second);
    assert.equal(first.style.transform, undefined);
    assert.equal(second.style.transform, undefined);
    assert.equal(h.strip.dataset.tabReordering, undefined);
    assert.equal(h.captures.size, 0);
    assert.equal(h.frames.size, 0);
    let stopped = false;
    h.api.stripEvents.onClickCapture({ detail: 1, preventDefault() {}, stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
  } finally { h.dispose(); }
});

test('Escape cancels the preview and restores the original order without a move callback', () => {
  const h = harness([createTab('a'), createTab('b'), createTab('c')]);
  try {
    h.api.onPointerDown(h.event(150), 'a');
    h.api.stripEvents.onPointerMove(h.event(480));
    h.flush();
    assert.equal(h.strip.dataset.tabReordering, 'true');
    h.escape();
    h.flush();
    assert.deepEqual(h.session.tabs.map((tab) => tab.id), ['a', 'b', 'c']);
    assert.deepEqual(h.moved, []);
    assert.equal(h.cards.get('a').style.transform, undefined);
    assert.equal(h.captures.size, 0);
    assert.equal(h.frames.size, 0);
  } finally { h.dispose(); }
});

test('dragging near an overflowing edge scrolls the strip and capture loss cancels cleanly', () => {
  const h = harness(['a', 'b', 'c', 'd', 'e'].map((id) => createTab(id)));
  try {
    h.api.onPointerDown(h.event(150), 'a');
    h.api.stripEvents.onPointerMove(h.event(490));
    h.flush();
    h.tick();
    assert.ok(h.strip.scrollLeft > 0);
    h.api.stripEvents.onLostPointerCapture();
    h.flush();
    assert.deepEqual(h.moved, []);
    assert.equal(h.frames.size, 0);
    assert.equal(h.strip.dataset.tabReordering, undefined);
  } finally { h.dispose(); }
});

test('title-sized linked cards freeze their individual widths and move together beside a wider tab', () => {
  const h = harness([enableTabSplit(createTab('pair'), 'right'), createTab('wide')],
    { pair: 88, right: 112, wide: 176 });
  try {
    h.api.onPointerDown(h.event(220), 'pair');
    h.api.stripEvents.onPointerMove(h.event(500));
    h.flush();
    assert.equal(h.cards.get('pair').style['--tab-drag-width'], '88px');
    assert.equal(h.cards.get('right').style['--tab-drag-width'], '112px');
    assert.equal(h.cards.get('pair').style.transform, h.cards.get('right').style.transform);
    h.api.stripEvents.onPointerUp(h.event(500));
    h.flush();
    assert.deepEqual(h.session.tabs.map((tab) => tab.id), ['wide', 'pair']);
    assert.equal(h.cards.get('pair').style['--tab-drag-width'], undefined);
    assert.equal(h.cards.get('right').style['--tab-drag-width'], undefined);
  } finally { h.dispose(); }
});
