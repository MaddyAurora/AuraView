import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import { bookmarkBarItems, loadBookmarks, moveBookmarkItem, putBookmark, reorderBookmarkIds, saveBookmarks } from '../src/lib/bookmarks.ts';

function fixture() {
  return { folders: [{ id: 'f1', name: 'Work' }, { id: 'f2', name: 'Local AI' }], bookmarks: [
    { id: 'a', title: 'A', url: 'https://example.com/a', folderId: null },
    { id: 'b', title: 'B', url: 'https://example.com/b', folderId: null },
    { id: 'c', title: 'C', url: 'https://example.com/c', folderId: 'f1' },
    { id: 'd', title: 'D', url: 'https://example.com/d', folderId: 'f2' },
    { id: 'e', title: 'E', url: 'https://example.com/e', folderId: 'f1' },
  ] };
}

test('folders and Root bookmarks interleave in one persisted bar order without changing their contents', () => {
  const original = fixture();
  let data = moveBookmarkItem(original, 'a', 0);
  data = moveBookmarkItem(data, 'f2', 3);
  assert.deepEqual(bookmarkBarItems(data).map((item) => item.id), ['a', 'f1', 'b', 'f2']);
  assert.equal(data.bookmarks, original.bookmarks);
  assert.equal(data.folders, original.folders);
  assert.equal(original.barOrder, undefined);
  let stored;
  saveBookmarks({ setItem: (_key, value) => { stored = value; } }, data);
  assert.deepEqual(bookmarkBarItems(loadBookmarks({ getItem: () => stored })).map((item) => item.id), ['a', 'f1', 'b', 'f2']);
});

test('reordering within a folder retains other folders, Root items, URLs and identities', () => {
  const data = { ...fixture(), barOrder: ['b', 'f1', 'a', 'f2'] };
  const next = moveBookmarkItem(data, 'e', 0, 'f1');
  assert.deepEqual(next.bookmarks.map((item) => item.id), ['a', 'b', 'e', 'd', 'c']);
  assert.equal(next.bookmarks[3], data.bookmarks[3]);
  assert.equal(next.bookmarks[0], data.bookmarks[0]);
  assert.equal(next.barOrder, data.barOrder);
  assert.equal(next.bookmarks[2], data.bookmarks[4]);
  assert.equal(moveBookmarkItem(data, 'a', 1, 'f1'), data);
});

test('adding, editing, moving and deleting bookmarks preserve a saved mixed bar order', () => {
  let data = { ...fixture(), barOrder: ['a', 'f2', 'b', 'f1'] };
  data = putBookmark(data, { ...data.bookmarks[0], title: 'Renamed' });
  assert.deepEqual(data.barOrder, ['a', 'f2', 'b', 'f1']);
  data = putBookmark(data, { ...data.bookmarks[0], folderId: 'f1' });
  assert.deepEqual(data.barOrder, ['f2', 'b', 'f1']);
  data = putBookmark(data, { ...data.bookmarks[2], folderId: null });
  assert.deepEqual(data.barOrder, ['f2', 'b', 'f1', 'c']);
  data = putBookmark(data, { title: 'New', url: 'https://example.org', folderId: null });
  assert.deepEqual(data.barOrder.slice(0, 4), ['f2', 'b', 'f1', 'c']);
  const newId = data.bookmarks.at(-1).id;
  assert.equal(data.barOrder.at(-1), newId);
  data = { ...data, bookmarks: data.bookmarks.filter((item) => item.id !== 'b') };
  assert.deepEqual(bookmarkBarItems(data).map((item) => item.id), ['f2', 'f1', 'c', newId]);
});

test('legacy and stale order data keep every current item exactly once and ignore invalid moves', () => {
  const data = fixture();
  assert.deepEqual(bookmarkBarItems(data).map((item) => item.id), ['f1', 'f2', 'a', 'b']);
  assert.deepEqual(bookmarkBarItems({ ...data, barOrder: ['b', 'missing', 'b', 'c'] }).map((item) => item.id), ['b', 'f1', 'f2', 'a']);
  assert.equal(moveBookmarkItem(data, 'missing', 1), data);
  assert.equal(moveBookmarkItem(data, 'a', NaN), data);
  assert.equal(moveBookmarkItem(data, 'c', 0), data);
});

function dragHarness(axis = 'x') {
  const previous = { window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const listeners = new Map(), frames = new Map(), slots = [], moves = [];
  let cursor = 0, effects = [], frameId = 0, current, ids = ['a', 'b', 'c'], capture;
  globalThis.window = { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: (event) => listeners.delete(event) };
  globalThis.requestAnimationFrame = (fn) => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const ref = { current: {
    scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, right: axis === 'x' ? 300 : 100, top: 0, bottom: axis === 'x' ? 40 : 300 }),
    querySelectorAll: () => current.order.map((id, i) => ({ dataset: { bookmarkItem: id }, getBoundingClientRect: () => ({ left: axis === 'x' ? i * 100 : 0, top: axis === 'y' ? i * 100 : 0, width: axis === 'x' ? 100 : 100, height: axis === 'y' ? 100 : 40 }) })),
    setPointerCapture: (id) => { capture = id; }, hasPointerCapture: (id) => capture === id, releasePointerCapture: () => { capture = undefined; },
  } };
  const code = ts.transpileModule(readFileSync(new URL('../src/hooks/useBookmarkReorder.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => name === 'react' ? hooks : { reorderBookmarkIds }, module, module.exports);
  const render = () => { cursor = 0; effects = []; current = module.exports.useBookmarkReorder(ref, ids, axis, (id, index) => moves.push([id, index])); effects.forEach((fn) => fn()); return current; };
  const event = (coordinate, extra = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: axis === 'x' ? coordinate : 20, clientY: axis === 'y' ? coordinate : 20, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
  render();
  return { moves, ref,
    get current() { return current; },
    down(id, position = 50) { current.onPointerDown(event(position), id); render(); },
    move(position) { current.events.onPointerMove(event(position)); render(); },
    up(position) { current.events.onPointerUp(event(position)); render(); },
    click() { const e = event(0); current.events.onClickCapture(e); return e; },
    cancel() { current.events.onPointerCancel(); render(); },
    escape() { listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); render(); },
    change(next) { ids = next; render(); render(); },
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); render(); },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } },
  };
}

test('clicks and small movements keep navigation intact; dragging reorders once without opening a bookmark', () => {
  const h = dragHarness();
  try {
    h.down('a'); h.move(53); h.up(53);
    assert.deepEqual(h.moves, []);
    assert.equal(h.click().defaultPrevented, undefined);
    h.down('a'); h.move(280);
    assert.deepEqual(h.current.order, ['b', 'c', 'a']);
    assert.equal(h.current.draggedId, 'a');
    h.up(280);
    assert.deepEqual(h.moves, [['a', 2]]);
    assert.equal(h.click().defaultPrevented, true);
    assert.equal(h.click().defaultPrevented, undefined);
  } finally { h.dispose(); }
});

test('vertical folder drags use row positions and cancellation never persists a preview', () => {
  const h = dragHarness('y');
  try {
    h.down('a'); h.move(280);
    assert.deepEqual(h.current.order, ['b', 'c', 'a']);
    h.escape();
    assert.deepEqual(h.current.order, ['a', 'b', 'c']);
    assert.deepEqual(h.moves, []);
    h.down('c', 250); h.move(20); h.up(20);
    assert.deepEqual(h.moves, [['c', 0]]);
    h.down('a'); h.move(280); h.cancel();
    assert.equal(h.moves.length, 1);
  } finally { h.dispose(); }
});

test('dropping outside, losing capture and changing the list cancel; edge drags scroll the container', () => {
  const h = dragHarness();
  try {
    h.down('a'); h.move(290); h.tick();
    assert.ok(h.ref.current.scrollLeft > 0);
    h.up(400);
    assert.deepEqual(h.moves, []);
    h.down('a'); h.move(290); h.current.events.onLostPointerCapture();
    assert.deepEqual(h.moves, []);
    h.down('a'); h.move(290); h.change(['a', 'c']);
    assert.equal(h.current.draggedId, null);
    assert.deepEqual(h.current.order, ['a', 'c']);
    h.up(290);
    assert.deepEqual(h.moves, []);
  } finally { h.dispose(); }
});
