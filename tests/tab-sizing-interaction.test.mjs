import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as tabState from '../src/lib/tabState.ts';
import * as tabSizing from '../src/lib/tabSizing.ts';

// Inspect the real hook's first render after insertion, before its measurement
// effect runs. A stale visible count can hide an existing page during that gap.
function harness(initialTabs, available = 1000) {
  const originals = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver,
    getComputedStyle: globalThis.getComputedStyle };
  const slots = [], observers = [];
  let cursor = 0, dirty = false, effects = [], result, tabs = initialTabs, frozen = false;
  const area = { current: { clientWidth: available + 28 + tabSizing.TAB_DRAG_SPACE } };
  const button = { current: { getBoundingClientRect: () => ({ width: 28 }) } };
  const strip = { current: { querySelectorAll: () => tabs.flatMap(tabState.orderedTabPages).map(({ page }) => ({
    dataset: { tabTitle: page.id }, getBoundingClientRect: () => ({ width: page.title.length * 7 }),
  })) } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: (title) => ({ width: title.length * 7 }) }) }) };
  globalThis.getComputedStyle = () => ({ marginLeft: '0', marginRight: '0', font: '12px sans-serif' });
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (value !== slots[index]) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useLayoutEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useTabSizing.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => name === 'react' ? hooks : name === '../lib/tabState' ? tabState
    : name === '../lib/tabSizing' ? tabSizing : assert.fail(`Unexpected import: ${name}`);
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const h = {
    get result() { return result; },
    render(nextTabs = tabs, nextFrozen = frozen) {
      tabs = nextTabs; frozen = nextFrozen; cursor = 0; effects = []; dirty = false;
      result = module.exports.useTabSizing(area, strip, button, tabs, frozen);
      return result;
    },
    commit() {
      let iterations = 0;
      do {
        effects.forEach((effect) => effect()); effects = [];
        if (!dirty) break;
        assert.ok(++iterations < 10, 'measurements should settle');
        h.render();
      } while (true);
      return result;
    },
    resize(available) {
      area.current.clientWidth = available + 28 + tabSizing.TAB_DRAG_SPACE;
      observers.at(-1).callback();
      if (dirty) h.render();
      return h.commit();
    },
    dispose() {
      slots.forEach((slot) => slot?.cleanup?.());
      for (const [name, value] of Object.entries(originals)) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    },
  };
  h.render(); h.commit();
  return h;
}

test('reopening at any position never temporarily hides or resizes an existing tab when there is room', () => {
  for (const closedId of ['first', 'middle', 'last']) {
    const tabs = ['first', 'middle', 'last'].map((id) => tabState.createTab(id));
    const h = harness(tabs);
    try {
      const original = h.result;
      const closed = tabState.closeTab({ tabs, activeTabId: 'last' }, closedId);
      h.render(closed.tabs); h.commit();
      const previous = h.result;
      const restored = tabState.reopenTab(closed);
      const insertion = h.render(restored.tabs);
      assert.equal(insertion.visibleCount, 3, 'the first render must already fit the restored list');
      for (const tab of closed.tabs) assert.equal(insertion.widths[tab.id], previous.widths[tab.id]);
      assert.equal(insertion.widths[restored.activeTabId], original.widths[closedId]);
      assert.ok(insertion.stripWidth > previous.stripWidth);
      h.commit();
      assert.equal(h.result.visibleCount, 3);
    } finally { h.dispose(); }
  }
});

test('restoring a split group, duplicating, and resizing use the current groups at the overflow boundary', () => {
  const pair = tabState.enableTabSplit(tabState.createTab('pair'), 'right');
  const tabs = [pair, tabState.createTab('other'), tabState.createTab('last')];
  const closed = tabState.closeTab({ tabs, activeTabId: 'last' }, 'pair');
  const h = harness(closed.tabs, 400);
  try {
    const restored = tabState.reopenTab(closed);
    assert.equal(h.render(restored.tabs).visibleCount, 3);
    h.commit();
    assert.equal(h.result.visibleCount, 3);
    const duplicate = tabState.duplicateTabPage(restored, restored.tabs[0].split.id);
    assert.equal(h.render(duplicate.tabs).visibleCount, 3);
    h.commit();
    assert.equal(h.resize(1000).visibleCount, 4);
    assert.equal(h.render(restored.tabs).visibleCount, 3, 'closing should not leave a stale count either');
    h.commit();
    const beforeDrag = h.result;
    h.render(restored.tabs, true); h.commit();
    assert.deepEqual(h.resize(220), beforeDrag, 'dragging keeps its captured sizes');
    h.render(restored.tabs, false); h.commit();
    assert.equal(h.result.visibleCount, 1);
  } finally { h.dispose(); }
});
