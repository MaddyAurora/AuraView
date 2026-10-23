import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitTabWidths, MAX_TAB_WIDTH, MIN_TAB_WIDTH, naturalTabWidth } from '../src/lib/tabSizing.ts';

test('tabs fit their measured title and controls, and the first linked page avoids an empty close-button slot', () => {
  assert.equal(naturalTabWidth(40, false), 112);
  assert.equal(naturalTabWidth(40, true), 88);
  assert.equal(naturalTabWidth(74.25, false), 147);
  assert.equal(naturalTabWidth(2000, false), MAX_TAB_WIDTH);
  assert.equal(naturalTabWidth(2000, true), MAX_TAB_WIDTH);
  assert.equal(naturalTabWidth(0, true), MIN_TAB_WIDTH);
  assert.equal(naturalTabWidth(40, false, true), 132);
  assert.equal(naturalTabWidth(40, true, true), 108);
});

test('a spacious bar keeps short titles compact and leaves unused space for dragging the window', () => {
  assert.deepEqual(fitTabWidths([88, 112, 176], 1000), [88, 112, 176]);
  assert.deepEqual(fitTabWidths([], 1000), []);
});

test('crowding lowers the largest widths first without stretching or prematurely clipping short titles', () => {
  const preferred = [90, 176, 176];
  const widths = fitTabWidths(preferred, 390);
  assert.equal(widths[0], 90);
  assert.ok(Math.abs(widths[1] - 150) < 0.001);
  assert.ok(Math.abs(widths[2] - 150) < 0.001);
  const crowded = fitTabWidths(preferred, 250);
  assert.ok(crowded.every((width) => Math.abs(width - 250 / 3) < 0.001));
  assert.ok(crowded.reduce((sum, width) => sum + width, 0) <= 250);
  assert.deepEqual(preferred, [90, 176, 176]);
});

test('width fitting keeps a usable minimum when capacity is exhausted', () => {
  assert.deepEqual(fitTabWidths([112, 176, 176, 90], 250), [80, 80, 80, 80]);
  assert.deepEqual(fitTabWidths([112, 176], 0), [80, 80]);
  assert.deepEqual(fitTabWidths([10, 1000], 500), [MIN_TAB_WIDTH, MAX_TAB_WIDTH]);
});

test('resizing the bar or changing a title recalculates widths within both bounds', () => {
  const titles = [40, 60, 400, 500, 70];
  const preferred = titles.map((width) => naturalTabWidth(width, false));
  for (const available of [0, 200, 400, 500, 650, 900]) {
    const widths = fitTabWidths(preferred, available);
    assert.ok(widths.every((width, i) => width >= MIN_TAB_WIDTH && width <= preferred[i]));
    if (available >= MIN_TAB_WIDTH * titles.length) {
      assert.ok(widths.reduce((sum, width) => sum + width, 0) <= available + 0.001);
    }
  }
  assert.ok(naturalTabWidth(40, false) < naturalTabWidth(120, false));
});
