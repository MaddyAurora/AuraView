import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTabStatus, createTab, enableTabSplit, moveTab, orderedTabPages, resizeTabSplit, swapTabPages, tabPageView, toggleSessionSplit } from '../src/lib/tabState.ts';
import { tabDragPlacement, tabDragScrollVelocity } from '../src/lib/tabDrag.ts';

test('moving a split group preserves both pages, their visual order, widths, histories, and active selection', () => {
  const pair = swapTabPages(resizeTabSplit(enableTabSplit(createTab('pair'), 'right'), 0.65));
  pair.canGoBack = true;
  pair.split.canGoForward = true;
  const first = createTab('first');
  const last = createTab('last');
  const original = { tabs: [first, pair, last], activeTabId: pair.id };
  const moved = moveTab(original, pair.id, 2);
  assert.deepEqual(moved.tabs.map((tab) => tab.id), ['first', 'last', 'pair']);
  assert.equal(moved.activeTabId, 'pair');
  assert.equal(moved.tabs[2], pair);
  assert.deepEqual(orderedTabPages(moved.tabs[2]).map(({ page }) => page.id), ['right', 'pair']);
  assert.equal(moved.tabs[2].splitRatio, 0.65);
  assert.equal(moved.tabs[2].canGoBack, true);
  assert.equal(moved.tabs[2].split.canGoForward, true);
  const updated = applyTabStatus(moved.tabs, { ...tabPageView(pair, 'secondary'), title: 'Updated right page' });
  assert.equal(updated[2].split.title, 'Updated right page');
  assert.equal(updated[0], first);
  assert.equal(updated[1], last);
  assert.deepEqual(original.tabs.map((tab) => tab.id), ['first', 'pair', 'last']);
});

test('a single tab can cross a linked group and detached pages can move independently', () => {
  const pair = enableTabSplit(createTab('pair'), 'right');
  const normal = createTab('normal');
  let session = moveTab({ tabs: [normal, pair], activeTabId: pair.id }, 'normal', 1);
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['pair', 'normal']);
  assert.equal(session.activeTabId, pair.id);
  session = toggleSessionSplit(session);
  session = moveTab(session, 'right', 2);
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['pair', 'normal', 'right']);
  assert.equal(session.activeTabId, 'pair');
});

test('tab moves clamp to either end and ignore missing, invalid, and unchanged destinations', () => {
  const session = { tabs: [createTab('a'), createTab('b'), createTab('c')], activeTabId: 'b' };
  assert.deepEqual(moveTab(session, 'b', -10).tabs.map((tab) => tab.id), ['b', 'a', 'c']);
  assert.deepEqual(moveTab(session, 'a', 100).tabs.map((tab) => tab.id), ['b', 'c', 'a']);
  assert.equal(moveTab(session, 'missing', 1), session);
  assert.equal(moveTab(session, 'a', NaN), session);
  assert.equal(moveTab(session, 'a', Infinity), session);
  assert.equal(moveTab(session, 'b', 1), session);
});

const items = [
  { id: 'a', left: 0, width: 180 },
  { id: 'pair', left: 180, width: 356 },
  { id: 'c', left: 536, width: 180 },
];

test('drag preview uses whole-group centers and widths without splitting a linked pair', () => {
  const right = tabDragPlacement(items, 'pair', 300);
  assert.equal(right.index, 2);
  assert.deepEqual([...right.offsets], [['a', 0], ['pair', 180], ['c', -356]]);
  const left = tabDragPlacement(items, 'pair', -400);
  assert.equal(left.index, 0);
  assert.deepEqual([...left.offsets], [['a', 356], ['pair', -180], ['c', 0]]);
  const beforeCenter = tabDragPlacement(items, 'a', 160);
  assert.equal(beforeCenter.index, 0);
  assert.equal(beforeCenter.offsets.get('pair'), 0);
  const afterCenter = tabDragPlacement(items, 'a', 200);
  assert.equal(afterCenter.index, 1);
  assert.equal(afterCenter.offsets.get('pair'), -180);
});

test('dragging at the ends is bounded, and missing or stationary drags do not move neighbors', () => {
  assert.equal(tabDragPlacement(items, 'a', -1000).offsets.get('a'), 0);
  assert.equal(tabDragPlacement(items, 'c', 1000).offsets.get('c'), 0);
  const still = tabDragPlacement(items, 'pair', NaN);
  assert.equal(still.index, 1);
  assert.ok([...still.offsets.values()].every((offset) => offset === 0));
  assert.equal(tabDragPlacement(items, 'missing', 50).index, -1);
  assert.equal(tabDragPlacement([], 'missing', 50).offsets.size, 0);
});

test('crowded tab bars scroll only near the edges, with bounded speed in both directions', () => {
  assert.equal(tabDragScrollVelocity(300, 100, 500), 0);
  assert.equal(tabDragScrollVelocity(100, 100, 500), -900);
  assert.equal(tabDragScrollVelocity(500, 100, 500), 900);
  assert.equal(tabDragScrollVelocity(120, 100, 500), -450);
  assert.equal(tabDragScrollVelocity(480, 100, 500), 450);
  assert.equal(tabDragScrollVelocity(-100, 100, 500), -900);
  assert.equal(tabDragScrollVelocity(700, 100, 500), 900);
  assert.equal(tabDragScrollVelocity(100, 100, 100), 0);
});
