import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSplitRatio, createLatestTaskRunner, splitRatioFromPointer } from '../src/lib/splitResize.ts';
import { addTab, createTab, enableTabSplit, resizeTabSplit, selectTab, swapTabPages, toggleSessionSplit } from '../src/lib/tabState.ts';

test('dragging tracks the grab offset and keeps both panes at least 240 pixels wide', () => {
  const left = 25;
  const width = 1008;
  assert.equal(splitRatioFromPointer(left + 500 + 2, left, width, 2), 0.5);
  assert.equal(splitRatioFromPointer(left + 650 + 2, left, width, 2), 0.65);
  assert.equal(splitRatioFromPointer(-1000, left, width), 0.24);
  assert.equal(splitRatioFromPointer(5000, left, width), 0.76);
  assert.equal(clampSplitRatio(0.2, 400), 0.5);
  assert.equal(clampSplitRatio(NaN, width), 0.5);
  assert.equal(splitRatioFromPointer(NaN, left, width), 0.5);
  assert.equal(splitRatioFromPointer(100, 0, 0), 0.5);
});

test('split widths survive tab switches and swapping, then clear when the pages separate', () => {
  const original = enableTabSplit(createTab('pair'));
  const resized = resizeTabSplit(original, 0.65);
  assert.equal(resized.splitRatio, 0.65);
  assert.equal(resized.url, original.url);
  assert.equal(resized.split, original.split);
  let session = addTab({ tabs: [resized], activeTabId: 'pair' }, createTab('other'));
  session = selectTab(session, 'pair');
  assert.equal(session.tabs[0].splitRatio, 0.65);
  assert.equal(session.tabs[1].splitRatio, undefined);
  assert.equal(swapTabPages(resized).splitRatio, 0.65);
  const detached = toggleSessionSplit(session);
  assert.equal(detached.tabs[0].splitRatio, undefined);
  assert.equal(detached.tabs[1].splitRatio, undefined);
  assert.equal(resizeTabSplit(resized, 0.65), resized);
  const single = createTab('single');
  assert.equal(resizeTabSplit(single, 0.7), single);
});

test('native resize work is serialized and skips superseded waiting layouts', async () => {
  const schedule = createLatestTaskRunner();
  const calls = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  schedule(async () => { calls.push('first start'); await blocked; calls.push('first end'); });
  schedule(async () => { calls.push('outdated'); });
  schedule(async () => { calls.push('latest'); finish(); });
  assert.deepEqual(calls, ['first start']);
  release();
  await done;
  assert.deepEqual(calls, ['first start', 'first end', 'latest']);
});
