import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
import * as bookmarks from '../src/lib/bookmarks.ts';
import { BOOKMARKS_KEY, bookmarkUrl, loadBookmarks, putBookmark, saveBookmarks } from '../src/lib/bookmarks.ts';

const empty = () => ({ bookmarks: [], folders: [] });

function componentHarness(path, overrides = {}) {
  const slots = [];
  let cursor = 0, effects = [];
  const hooks = { ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const url = new URL(path, import.meta.url);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const require = createRequire(url);
  const mocks = { react: hooks, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../lib/bookmarks': bookmarks, './BookmarkDialog': { BookmarkDialog() {} }, './BookmarkMenu': { BookmarkMenu() {} },
    './BookmarkFolderMenu': { BookmarkFolderMenu() {} },
    '../hooks/useBookmarkReorder': { useBookmarkReorder: (_ref, ids) => ({ order: ids, events: {}, onPointerDown() {} }) }, ...overrides };
  new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? require(name), module, module.exports);
  const Component = Object.values(module.exports)[0];
  return {
    render(props = {}) { cursor = 0; effects = []; const tree = Component(props); effects.forEach((fn) => fn()); return tree; },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test('bookmarks persist in Root and named folders and survive a reload', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let data = loadBookmarks(storage);
  data = putBookmark(data, { title: ' Search ', url: 'https://example.com/results?q=one#two', folderId: null });
  data = putBookmark(data, { title: 'ComfyUI', url: 'localhost:8188', folderId: null, newFolder: ' Local AI ' });
  data = putBookmark(data, { title: 'Tools', url: 'https://example.org', folderId: data.folders[0].id });
  saveBookmarks(storage, data);
  assert.deepEqual(loadBookmarks(storage), data);
  assert.equal(data.bookmarks[0].title, 'Search');
  assert.equal(data.bookmarks[0].folderId, null);
  assert.equal(data.bookmarks[0].url, 'https://example.com/results?q=one#two');
  assert.equal(data.bookmarks[1].url, 'http://localhost:8188/');
  assert.equal(data.bookmarks[2].folderId, data.folders[0].id);
  assert.equal(data.folders[0].name, 'Local AI');
});

test('editing moves a bookmark between folders and Root without changing its identity', () => {
  let data = putBookmark(empty(), { title: 'Original', url: 'https://example.com', folderId: null, newFolder: 'Work' });
  const original = data;
  const id = data.bookmarks[0].id;
  data = putBookmark(data, { id, title: 'Updated', url: 'https://example.org/path', folderId: null });
  assert.equal(data.bookmarks.length, 1);
  assert.deepEqual(data.bookmarks[0], { id, title: 'Updated', url: 'https://example.org/path', folderId: null });
  assert.equal(original.bookmarks[0].title, 'Original');
  assert.equal(original.bookmarks[0].folderId, original.folders[0].id);
});

test('creating an existing folder reuses it without duplicating or losing its bookmarks', () => {
  let data = putBookmark(empty(), { title: 'One', url: 'example.com', folderId: null, newFolder: 'Work' });
  data = putBookmark(data, { title: 'Two', url: 'example.org', folderId: null, newFolder: ' work ' });
  assert.equal(data.folders.length, 1);
  assert.equal(data.bookmarks[0].folderId, data.bookmarks[1].folderId);
});

test('invalid titles, folder selections and unsafe links cannot be saved', () => {
  const draft = { title: 'Test', url: 'https://example.com', folderId: null };
  assert.throws(() => putBookmark(empty(), { ...draft, title: ' ' }), /title/);
  assert.throws(() => putBookmark(empty(), { ...draft, folderId: 'missing' }), /folder/);
  assert.throws(() => putBookmark(empty(), { ...draft, newFolder: ' ' }), /name/);
  for (const url of ['', 'https://', 'not a link', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'file:///C:/test']) {
    assert.throws(() => bookmarkUrl(url), /link/);
  }
  assert.equal(bookmarkUrl('127.0.0.1:3000/path'), 'http://127.0.0.1:3000/path');
  assert.equal(bookmarkUrl('[::1]:3000'), 'http://[::1]:3000/');
  assert.equal(bookmarkUrl('example.com:8443/path'), 'https://example.com:8443/path');
});

test('corrupt stored data and failed writes surface errors without overwriting saved bookmarks', () => {
  for (const raw of ['{', 'null', '{}', JSON.stringify({ bookmarks: [{ id: 'a', title: 'A', url: 'https://example.com', folderId: 'missing' }], folders: [] })]) {
    const storage = { getItem: () => raw, setItem: () => assert.fail('must not overwrite corrupt data') };
    assert.throws(() => loadBookmarks(storage));
  }
  const values = new Map([[BOOKMARKS_KEY, JSON.stringify(empty())]]);
  assert.throws(() => saveBookmarks({ setItem() { throw new Error('Quota exceeded'); } }, empty()), /Quota/);
  assert.equal(values.get(BOOKMARKS_KEY), JSON.stringify(empty()));
});

test('adding a page discards its tab ID, saves it as a new bookmark, and retains it when toggled', () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  const slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect() {},
  };
  const url = new URL('../src/components/BookmarksBar.tsx', import.meta.url);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const require = createRequire(url);
  const mocks = { react: hooks, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '@tauri-apps/api/core': { invoke() {} }, '@tauri-apps/api/event': { listen() {} },
    '../lib/bookmarks': bookmarks, './BookmarkDialog': { BookmarkDialog() {} }, './BookmarkMenu': { BookmarkMenu() {} },
    './BookmarkFolderMenu': { BookmarkFolderMenu() {} },
    '../hooks/useBookmarkReorder': { useBookmarkReorder: (_ref, ids) => ({ order: ids, events: {}, onPointerDown() {} }) } };
  new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? require(name), module, module.exports);
  const changes = [];
  const props = { visible: true, getCurrentPage: () => ({ id: 'tab-123', title: 'Current page', url: 'https://example.com/path' }), onOpen() {}, onDialogChange: (open) => changes.push(open) };
  const render = (visible = true) => { cursor = 0; return module.exports.BookmarksBar({ ...props, visible }); };
  try {
    let tree = render();
    tree.props.children[0].props.children[1].props.onClick();
    tree = render();
    const dialog = tree.props.children[2].props;
    assert.deepEqual(dialog.draft, { title: 'Current page', url: 'https://example.com/path', folderId: null });
    dialog.onSave(putBookmark(dialog.data, dialog.draft));
    assert.deepEqual(changes, [true, false]);
    render(false);
    tree = render(true);
    const stored = loadBookmarks(window.localStorage);
    assert.equal(stored.bookmarks.length, 1);
    assert.notEqual(stored.bookmarks[0].id, 'tab-123');
    assert.equal(stored.bookmarks[0].url, 'https://example.com/path');
    assert.equal(tree.props.children[0].props.children[0].props.children[0][0].props.title, 'Current page\nhttps://example.com/path');
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test('desktop add and edit use a separate native window and apply its save and close events', async () => {
  const original = globalThis.window;
  const data = putBookmark(empty(), { title: 'Saved page', url: 'https://example.org', folderId: null });
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => JSON.stringify(data) } };
  const events = new Map(), calls = [], changes = [];
  const harness = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => calls.push({ command, args }) },
    '@tauri-apps/api/event': { listen: async (event, callback) => { events.set(event, callback); return () => events.delete(event); } },
  });
  const props = { visible: true, getCurrentPage: () => ({ id: 'tab-1', title: 'Current page', url: 'https://example.com/current' }), onOpen() {}, onDialogChange: (open) => changes.push(open) };
  try {
    let tree = harness.render(props);
    tree.props.children[0].props.children[1].props.onClick();
    tree = harness.render(props);
    assert.equal(tree.props.children[2], null, 'no HTML dialog may replace the native page');
    assert.deepEqual(calls.at(-1), { command: 'show_bookmark_editor', args: { draft: { title: 'Current page', url: 'https://example.com/current', folderId: null }, data } });
    events.get('bookmark-editor-closed')({});
    events.get('bookmark-menu-select')({ payload: `edit:${data.bookmarks[0].id}` });
    assert.deepEqual(calls.at(-1).args.draft, data.bookmarks[0]);
    const updated = putBookmark(data, { ...data.bookmarks[0], title: 'Updated from editor' });
    events.get('bookmark-editor-saved')({ payload: updated });
    tree = harness.render(props);
    assert.equal(tree.props.children[0].props.children[0].props.children[0][0].props.title, 'Updated from editor\nhttps://example.org/');
    events.get('bookmark-editor-closed')({});
    assert.deepEqual(changes, [true, false, true, false]);
    await new Promise((resolve) => setImmediate(resolve));
    harness.dispose();
    assert.equal(events.size, 0);
  } finally { globalThis.window = original; }
});

test('native editor saves before notifying the bar and closing, and stays open when storage fails', async () => {
  const original = globalThis.window;
  const log = [];
  let storageFails = false;
  globalThis.window = { localStorage: { setItem(key, value) { if (storageFails) throw new Error('Quota'); log.push(['persist', key, JSON.parse(value)]); } } };
  const draft = { title: 'Current page', url: 'https://example.com', folderId: null };
  const harness = componentHarness('../src/components/BookmarkEditorWindow.tsx', {
    '@tauri-apps/api/core': { invoke: async (command) => { if (command === 'get_bookmark_editor') return { draft, data: empty() }; log.push([command]); } },
    '@tauri-apps/api/event': { emitTo: async (...args) => log.push(['emit', ...args]) },
  });
  try {
    harness.render();
    await new Promise((resolve) => setImmediate(resolve));
    const dialog = harness.render().props.children[0].props;
    assert.equal(dialog.standalone, true);
    assert.deepEqual(dialog.draft, draft);
    const updated = putBookmark(empty(), draft);
    storageFails = true;
    await assert.rejects(() => dialog.onSave(updated), /Unable to save bookmarks/);
    assert.deepEqual(log, []);
    storageFails = false;
    await dialog.onSave(updated);
    assert.deepEqual(log, [['persist', BOOKMARKS_KEY, updated], ['emit', 'main', 'bookmark-editor-saved', updated], ['close_bookmark_editor']]);
    harness.dispose();
  } finally { globalThis.window = original; }
});

test('folder contents contain only saved pages and Add, with right-click actions targeting the exact page', () => {
  const data = { folders: [{ id: 'folder', name: 'Work' }], bookmarks: [
    { id: 'one', title: 'One', url: 'https://example.com/one', folderId: 'folder' },
    { id: 'two', title: 'Two', url: 'https://example.com/two', folderId: 'folder' },
    { id: 'root', title: 'Root page', url: 'https://example.com', folderId: null },
  ] };
  const harness = componentHarness('../src/components/BookmarkFolderContents.tsx');
  const actions = [], contexts = [];
  const tree = harness.render({ data, folderId: 'folder', onAction: (action) => actions.push(action), onContext: (...args) => contexts.push(args), onMove() {} });
  const rows = tree.props.children[0].props.children[0];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.props.children[1].props.children), ['One', 'Two']);
  assert.equal(tree.props.children[1].props.role, 'menuitem');
  rows[1].props.onContextMenu({ preventDefault() {}, clientX: 40, clientY: 80 });
  assert.deepEqual(contexts, [['two', 40, 80]]);
  assert.deepEqual(actions, []);
  rows[0].props.onClick({ ctrlKey: false, metaKey: false });
  tree.props.children[1].props.onClick();
  assert.deepEqual(actions, ['open:one', 'add:folder']);
  harness.dispose();
});

test('desktop folder popup reorders and refreshes its bookmarks, with Edit and Delete only in the context menu', async () => {
  const original = globalThis.window;
  const data = { folders: [{ id: 'folder', name: 'Work' }], bookmarks: [
    { id: 'one', title: 'One', url: 'https://example.com/one', folderId: 'folder' },
    { id: 'two', title: 'Two', url: 'https://example.com/two', folderId: 'folder' },
  ] };
  let stored = JSON.stringify(data);
  const events = new Map(), calls = [], broadcasts = [];
  globalThis.window = { localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } };
  const harness = componentHarness('../src/components/BookmarkFolderWindow.tsx', {
    './BookmarkFolderContents': { BookmarkFolderContents() {} },
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args }); if (command === 'get_bookmark_folder') return 'folder'; } },
    '@tauri-apps/api/event': { emit: async (...args) => broadcasts.push(args), emitTo: async () => {}, listen: async (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
  });
  try {
    harness.render();
    await new Promise((resolve) => setImmediate(resolve));
    let contents = harness.render().props.children[0].props.children.props;
    assert.equal(contents.folderId, 'folder');
    contents.onContext('two', 12, 34);
    assert.deepEqual(calls.at(-1), { command: 'show_bookmark_menu', args: { x: 12, y: 34, items: [
      { id: 'open:two', label: 'Open' }, { id: 'newtab:two', label: 'Open in new tab' },
      { id: 'edit:two', label: 'Edit bookmark…' }, { id: 'delete:two', label: 'Delete bookmark' },
    ] } });
    contents.onMove('two', 0);
    assert.deepEqual(JSON.parse(stored).bookmarks.map((item) => item.id), ['two', 'one']);
    assert.equal(broadcasts.at(-1)[0], 'bookmarks-changed');
    events.get('bookmarks-changed')({ payload: { ...data, bookmarks: [data.bookmarks[0]] } });
    contents = harness.render().props.children[0].props.children.props;
    assert.deepEqual(contents.data.bookmarks.map((item) => item.id), ['one']);
    harness.dispose();
    assert.equal(events.size, 0);
  } finally { globalThis.window = original; }
});
