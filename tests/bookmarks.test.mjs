import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
import * as bookmarks from '../src/lib/bookmarks.ts';
import { BOOKMARKS_KEY, bookmarkUrl, loadBookmarks, putBookmark, saveBookmarks } from '../src/lib/bookmarks.ts';
import * as bookmarkTransfer from '../src/lib/bookmarkTransfer.ts';

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
    '../lib/bookmarks': bookmarks, '../lib/bookmarkTransfer': bookmarkTransfer, './BookmarkDialog': { BookmarkDialog() {} }, './BookmarkMenu': { BookmarkMenu() {} },
    './BookmarkFolderMenu': { BookmarkFolderMenu() {} },
    './SiteIcon': { SiteIcon: ({ fallback }) => fallback },
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
    './SiteIcon': { SiteIcon: ({ fallback }) => fallback },
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
  const favicon = 'data:image/png;base64,iVBORw0KGgo=';
  const props = { visible: true, getCurrentPage: () => ({ id: 'tab-1', title: 'Current page', url: 'https://example.com/current', favicon }), onOpen() {}, onDialogChange: (open) => changes.push(open) };
  try {
    let tree = harness.render(props);
    tree.props.children[0].props.children[1].props.onClick();
    tree = harness.render(props);
    assert.equal(tree.props.children[2], null, 'no HTML dialog may replace the native page');
    assert.deepEqual(calls.at(-1), { command: 'show_bookmark_editor', args: { draft: { title: 'Current page', url: 'https://example.com/current', folderId: null, favicon }, data } });
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

test('native favicon updates persist icons for visited bookmarks and notify open folder windows once', async () => {
  const previousWindow = globalThis.window;
  let data = putBookmark(empty(), { title: 'Saved page', url: 'https://example.com/', folderId: null });
  const events = new Map(), messages = [];
  let writes = 0;
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: {
    getItem: () => JSON.stringify(data), setItem: (_, value) => { data = JSON.parse(value); writes++; },
  } };
  const h = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/api/event': {
      listen: async (event, callback) => { events.set(event, callback); return () => events.delete(event); },
      emit: async (...args) => messages.push(args),
    },
  });
  try {
    h.render({ visible: true, getCurrentPage: () => ({ title: 'Page', url: 'https://example.com/' }), onOpen() {}, onDialogChange() {} });
    const favicon = 'data:image/png;base64,iVBORw0KGgo=';
    events.get('webview-status')({ payload: { favicon, faviconPageUrl: 'https://example.com/' } });
    assert.equal(data.bookmarks[0].favicon, favicon);
    assert.equal(writes, 1);
    assert.deepEqual(messages, [['bookmarks-changed', data]]);
    events.get('webview-status')({ payload: { favicon, faviconPageUrl: 'https://example.com/' } });
    events.get('webview-status')({ payload: { favicon, faviconPageUrl: 'https://different.example/' } });
    events.get('webview-status')({ payload: { favicon: 'https://tracker.example/icon', faviconPageUrl: 'https://example.com/' } });
    assert.equal(writes, 1);
    await new Promise((resolve) => setImmediate(resolve));
  } finally { h.dispose(); globalThis.window = previousWindow; }
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
  const rows = tree.props.children[0].props.children[1];
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

test('the toolbar import/export menu merges the latest collection, ignores duplicate clicks and uses native pickers', async () => {
  const original = globalThis.window, calls = [], events = new Map(), broadcasts = [], dialogs = [];
  let current = putBookmark(empty(), { title: 'Existing', url: 'https://existing.example/', folderId: null });
  let stored = JSON.stringify(current), finishImport;
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } };
  const harness = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'import_bookmarks_html') return new Promise((resolve) => { finishImport = resolve; });
      if (command === 'export_bookmarks_html') return true;
    } },
    '@tauri-apps/api/event': {
      emit: async (...args) => broadcasts.push(args),
      listen: async (name, callback) => { events.set(name, callback); return () => events.delete(name); },
    },
  });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange: (open) => dialogs.push(open) };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    let tree = harness.render(props);
    tree.props.children[0].props.onContextMenu({ preventDefault() {}, clientX: 12, clientY: 34 });
    assert.deepEqual(calls.at(-1).args.items.map((item) => item.id), ['add', 'import', 'export']);
    events.get('bookmark-menu-select')({ payload: 'import' });
    events.get('bookmark-menu-select')({ payload: 'import' });
    await settle();
    assert.equal(calls.filter((call) => call.command === 'import_bookmarks_html').length, 1);
    current = putBookmark(current, { title: 'Added during picker', url: 'https://later.example/', folderId: null });
    stored = JSON.stringify(current);
    finishImport('<DL><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Favorites bar</H3><DL><DT><H3>Imported</H3><DL><DT><A HREF="https://imported.example/">Imported page</A></DL></DL></DL>');
    await settle();
    tree = harness.render(props);
    const data = JSON.parse(stored);
    assert.deepEqual(data.bookmarks.map((bookmark) => bookmark.title), ['Existing', 'Added during picker', 'Imported page']);
    assert.equal(broadcasts.at(-1)[0], 'bookmarks-changed');
    assert.deepEqual(dialogs, [true, false]);
    assert.match(tree.props.children[0].props.children[0].props.children.at(-1).props.children, /Imported 1 bookmark and 1 folder/);
    events.get('bookmark-menu-select')({ payload: 'export' });
    await settle();
    assert.equal(calls.at(-1).command, 'export_bookmarks_html');
    assert.equal(calls.at(-1).args.html, bookmarkTransfer.exportBookmarkHtml(data));
    assert.equal(stored, JSON.stringify(data), 'export does not edit bookmarks');
    tree = harness.render(props);
    assert.equal(tree.props.children[0].props.children[0].props.children.at(-1).props.children, 'Bookmarks exported.');
    harness.dispose();
  } finally { globalThis.window = original; }
});

test('cancelled, invalid and unsavable imports leave existing bookmarks intact and release the dialog state', async () => {
  const original = globalThis.window;
  const data = putBookmark(empty(), { title: 'Keep', url: 'https://keep.example/', folderId: null });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange() {} };
  try {
    for (const scenario of ['cancel', 'invalid', 'storage']) {
      const stored = JSON.stringify(data), events = new Map(), dialogs = [];
      globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => stored, setItem() { throw new Error('Quota'); } } };
      const harness = componentHarness('../src/components/BookmarksBar.tsx', {
        '@tauri-apps/api/core': { invoke: async () => scenario === 'cancel' ? null : scenario === 'invalid' ? 'Not bookmark HTML' : '<DL><DT><A HREF="https://imported.example/">New</A></DL>' },
        '@tauri-apps/api/event': { listen: async (name, callback) => { events.set(name, callback); return () => {}; } },
      });
      harness.render({ ...props, onDialogChange: (open) => dialogs.push(open) });
      events.get('bookmark-menu-select')({ payload: 'import' });
      await new Promise((resolve) => setImmediate(resolve));
      const tree = harness.render(props), strip = tree.props.children[0].props.children[0];
      assert.deepEqual(dialogs, [true, false]);
      assert.equal(strip.props.children[0][0].props.title, 'Keep\nhttps://keep.example/');
      if (scenario === 'cancel') assert.equal(strip.props.children[2], '');
      else assert.match(strip.props.children[2].props.children, scenario === 'storage' ? /Unable to save/ : /bookmarks HTML file/);
      assert.equal(stored, JSON.stringify(data));
      harness.dispose();
    }
  } finally { globalThis.window = original; }
});

test('nested folder navigation targets its own bookmarks, Add action and drag order', () => {
  const { data } = bookmarkTransfer.importBookmarkHtml('<DL><DT><H3>Root folder</H3><DL><DT><H3>Child</H3><DL><DT><A HREF="https://child.example/">Child page</A></DL></DL></DL>', empty());
  const root = data.folders[0], child = data.folders[1], actions = [], moves = [];
  const harness = componentHarness('../src/components/BookmarkFolderContents.tsx', {
    '../hooks/useBookmarkReorder': { useBookmarkReorder: (_ref, ids, _axis, move) => { moves.push(move); return { order: ids, events: {}, onPointerDown() {} }; } },
  });
  const props = { data, folderId: root.id, onAction: (action) => actions.push(action), onContext() {}, onMove: (...args) => actions.push(args) };
  try {
    let tree = harness.render(props);
    tree.props.children[0].props.children[1][0].props.onClick();
    tree = harness.render(props);
    assert.equal(tree.props['aria-label'], 'Root folder / Child');
    tree.props.children[0].props.children[1][0].props.onClick({});
    tree.props.children[1].props.onClick();
    moves.at(-1)(data.bookmarks[0].id, 0);
    assert.deepEqual(actions, [`open:${data.bookmarks[0].id}`, `add:${child.id}`, [data.bookmarks[0].id, 0, child.id]]);
    tree.props.children[0].props.children[0].props.onClick();
    tree = harness.render(props);
    assert.equal(tree.props['aria-label'], 'Root folder');
    assert.equal(bookmarks.bookmarkBarItems(data).length, 1, 'nested folders do not leak onto the bar');
  } finally { harness.dispose(); }
});

test('toolbar folder clicks carry their opener bounds and folder context menus delete the selected subtree', async () => {
  const original = globalThis.window, calls = [], events = new Map(), broadcasts = [];
  const { data } = bookmarkTransfer.importBookmarkHtml('<DL><DT><H3>Remove</H3><DL><DT><H3>Child</H3><DL><DT><A HREF="https://remove.example/">Remove me</A></DL></DL><DT><H3>Keep</H3><DL></DL></DL>', empty());
  const root = data.folders[0], keep = data.folders[2];
  let stored = JSON.stringify(data);
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } };
  const harness = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => calls.push({ command, args }) },
    '@tauri-apps/api/event': { emit: async (...args) => broadcasts.push(args), listen: async (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
  });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange() {} };
  try {
    let tree = harness.render(props);
    const folder = tree.props.children[0].props.children[0].props.children[0][0];
    const click = { currentTarget: { getBoundingClientRect: () => ({ left: 20, top: 60, bottom: 88, width: 100, height: 28 }) } };
    folder.props.onClick(click);
    assert.deepEqual(calls.at(-1), { command: 'show_bookmark_folder', args: { folderId: root.id, x: 20, y: 91, height: 400, anchor: { x: 20, y: 60, width: 100, height: 28 } } });
    let stopped = false;
    folder.props.onContextMenu({ preventDefault() {}, stopPropagation() { stopped = true; }, clientX: 30, clientY: 70 });
    assert.equal(stopped, true);
    assert.ok(calls.at(-1).args.items.some((item) => item.id === `delete-folder:${root.id}`));
    events.get('bookmark-menu-select')({ payload: `delete-folder:${root.id}` });
    tree = harness.render(props);
    assert.deepEqual(JSON.parse(stored).folders.map((folder) => folder.id), [keep.id]);
    assert.equal(JSON.parse(stored).bookmarks.length, 0);
    assert.equal(calls.at(-1).command, 'close_bookmark_folder');
    assert.equal(broadcasts.at(-1)[0], 'bookmarks-changed');
    assert.equal(tree.props.children[0].props.children[0].props.children[0].length, 1);
  } finally { harness.dispose(); globalThis.window = original; }
});

test('folder deletion does not apply or close the popup if saving fails', () => {
  const original = globalThis.window, calls = [], events = new Map();
  const data = { folders: [{ id: 'keep', name: 'Keep' }], bookmarks: [] };
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => JSON.stringify(data), setItem() { throw new Error('Quota'); } } };
  const harness = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async (command) => calls.push(command) },
    '@tauri-apps/api/event': { listen: async (name, fn) => { events.set(name, fn); return () => {}; } },
  });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange() {} };
  try {
    harness.render(props);
    events.get('bookmark-menu-select')({ payload: 'delete-folder:keep' });
    const strip = harness.render(props).props.children[0].props.children[0];
    assert.equal(strip.props.children[0][0].props.title, 'Keep');
    assert.match(strip.props.children[2].props.children, /Unable to save bookmarks/);
    assert.deepEqual(calls, []);
  } finally { harness.dispose(); globalThis.window = original; }
});

test('preview folder pointerdown and click close the opener without reopening it; other clicks dismiss normally', () => {
  const original = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  const listeners = new Map();
  const data = { folders: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], bookmarks: [] };
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(data) }, innerHeight: 800, innerWidth: 1000, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { body: {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  globalThis.Element = class { constructor(id) { this.id = id; } closest() { return this; } getAttribute() { return this.id; } };
  const bar = componentHarness('../src/components/BookmarksBar.tsx');
  const popup = componentHarness('../src/components/BookmarkFolderMenu.tsx', { 'react-dom': { createPortal: (node) => node }, './BookmarkFolderContents': { BookmarkFolderContents() {} } });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange() {} };
  const click = { currentTarget: { getBoundingClientRect: () => ({ left: 20, top: 60, bottom: 88, width: 100, height: 28 }) } };
  try {
    let tree = bar.render(props);
    tree.props.children[0].props.children[0].props.children[0][0].props.onClick(click);
    tree = bar.render(props);
    popup.render(tree.props.children[3].props);
    listeners.get('pointerdown')({ button: 0, target: new Element('one') });
    tree = bar.render(props);
    tree.props.children[0].props.children[0].props.children[0][0].props.onClick(click);
    tree = bar.render(props);
    assert.equal(tree.props.children[3], null);
    tree.props.children[0].props.children[0].props.children[0][1].props.onClick(click);
    tree = bar.render(props);
    assert.equal(tree.props.children[3].props.folderId, 'two');
    popup.render(tree.props.children[3].props);
    listeners.get('pointerdown')({ button: 0, target: new Element('outside') });
    assert.equal(bar.render(props).props.children[3], null);
  } finally { popup.dispose(); bar.dispose(); Object.assign(globalThis, original); }
});

test('nested folders expose a folder-specific delete menu in the native popup', async () => {
  const original = globalThis.window, calls = [];
  const data = { folders: [{ id: 'root', name: 'Root' }, { id: 'child', name: 'Child', parentId: 'root' }], bookmarks: [] };
  globalThis.window = { localStorage: { getItem: () => JSON.stringify(data) } };
  const harness = componentHarness('../src/components/BookmarkFolderWindow.tsx', {
    './BookmarkFolderContents': { BookmarkFolderContents() {} },
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args }); if (command === 'get_bookmark_folder') return 'root'; } },
    '@tauri-apps/api/event': { listen: async () => () => {} },
  });
  try {
    harness.render(); await new Promise((resolve) => setImmediate(resolve));
    const contents = harness.render().props.children[0].props.children.props;
    contents.onFolderContext('child', 12, 34);
    assert.deepEqual(calls.at(-1), { command: 'show_bookmark_menu', args: { x: 12, y: 34, items: [
      { id: 'add:child', label: 'Add current page…' }, { id: 'delete-folder:child', label: 'Delete folder' },
    ] } });
  } finally { harness.dispose(); globalThis.window = original; }
});

test('green bookmark notices expire after five seconds and repeated messages restart the countdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.window, events = new Map();
  let stored = JSON.stringify({ folders: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], bookmarks: [] });
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } };
  const harness = componentHarness('../src/components/BookmarksBar.tsx', {
    '@tauri-apps/api/core': { invoke: async () => true },
    '@tauri-apps/api/event': { emit: async () => {}, listen: async (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
  });
  const props = { visible: true, getCurrentPage() {}, onOpen() {}, onDialogChange() {} };
  const notice = () => harness.render(props).props.children[0].props.children[0].props.children.at(-1);
  try {
    harness.render(props);
    events.get('bookmark-menu-select')({ payload: 'delete-folder:one' });
    assert.equal(notice().props.children, 'Folder and its contents deleted.');
    t.mock.timers.tick(3000);
    events.get('bookmark-menu-select')({ payload: 'delete-folder:two' });
    t.mock.timers.tick(2000);
    assert.equal(notice().props.children, 'Folder and its contents deleted.', 'the old timeout cannot dismiss a new identical message');
    t.mock.timers.tick(2999);
    assert.equal(notice().props.role, 'status');
    t.mock.timers.tick(1);
    assert.equal(notice(), '');
    events.get('bookmark-menu-select')({ payload: 'export' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(notice().props.children, 'Bookmarks exported.');
    t.mock.timers.tick(5000);
    assert.equal(notice(), '');
  } finally { harness.dispose(); globalThis.window = original; }
});
