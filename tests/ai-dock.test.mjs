import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import * as aiDock from '../src/lib/aiDock.ts';
import { DEFAULT_AI_SERVERS } from '../src/types/browser.ts';

const draft = { name: 'Custom AI', port: '7860', color: '#1234AB', description: 'My server' };
const storage = () => {
  let saved = null;
  return { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
};

test('Dock entries persist edits and colors, and an empty saved list does not restore deleted defaults', () => {
  const store = storage(), original = aiDock.loadAiDock(store);
  assert.deepEqual(original, DEFAULT_AI_SERVERS);
  assert.notEqual(original, DEFAULT_AI_SERVERS);
  const added = aiDock.putAiDockServer(original, draft), custom = added.at(-1);
  assert.equal(custom.port, 7860); assert.equal(custom.color, '#1234ab');
  assert.equal(aiDock.aiDockUrl(custom), 'http://localhost:7860');
  const edited = aiDock.putAiDockServer(added, { ...draft, id: original[0].id, name: 'Changed default', port: ' 9000 ', color: '#ef4444' });
  assert.equal(edited[0].id, 'comfyui'); assert.equal(edited[0].port, 9000);
  assert.equal(edited[1], original[1]);
  assert.equal(original[0].port, 8188);
  aiDock.saveAiDock(store, edited);
  assert.deepEqual(aiDock.loadAiDock(store), edited);
  aiDock.saveAiDock(store, []);
  assert.deepEqual(aiDock.loadAiDock(store), []);
});

test('saved Dock reordering preserves entries and survives edits, additions and reloads', () => {
  const store = storage(), original = aiDock.loadAiDock(store);
  const reordered = aiDock.moveAiDockServer(original, 'comfyui', 3);
  assert.deepEqual(reordered.map((server) => server.id), ['ollama-webui', 'ollama-api', 'pinokio', 'comfyui']);
  assert.equal(reordered[3], original[0]);
  assert.equal(original[0].id, 'comfyui');
  const edited = aiDock.putAiDockServer(reordered, { ...draft, id: 'ollama-api' });
  const added = aiDock.putAiDockServer(edited, draft);
  aiDock.saveAiDock(store, added);
  const reloaded = aiDock.loadAiDock(store);
  assert.deepEqual(reloaded.slice(0, 4).map((server) => server.id), reordered.map((server) => server.id));
  assert.equal(reloaded[1].color, '#1234ab');
  assert.equal(reloaded.at(-1).name, draft.name);
  assert.equal(aiDock.moveAiDockServer(reordered, 'missing', 0), reordered);
  assert.equal(aiDock.moveAiDockServer(reordered, 'comfyui', NaN), reordered);
  assert.equal(aiDock.moveAiDockServer(reordered, 'comfyui', 3), reordered);
});

test('ports, names, colors and saved data are validated without accepting partial numbers or replacing storage', () => {
  for (const port of ['0', '65536', '-1', '1.2', '12x', '1e3', '', 'Infinity']) {
    assert.throws(() => aiDock.putAiDockServer([], { ...draft, port }), /port/);
    assert.throws(() => aiDock.aiDockPort(port), /port/);
  }
  assert.equal(aiDock.aiDockPort('65535'), 65535);
  assert.throws(() => aiDock.putAiDockServer([], { ...draft, name: ' ' }), /name/);
  assert.throws(() => aiDock.putAiDockServer([], { ...draft, color: 'red; url(x)' }), /color/);
  assert.throws(() => aiDock.putAiDockServer([], { ...draft, id: 'missing' }), /no longer exists/);
  for (const raw of ['{', 'null', '{}', JSON.stringify([{ ...DEFAULT_AI_SERVERS[0], color: 'bg-red-500' }]),
    JSON.stringify([DEFAULT_AI_SERVERS[0], DEFAULT_AI_SERVERS[0]]), JSON.stringify([{ ...DEFAULT_AI_SERVERS[0], path: '//outside.example/' }])]) {
    assert.throws(() => aiDock.loadAiDock({ getItem: () => raw }));
  }
  assert.throws(() => aiDock.saveAiDock({ setItem() { throw new Error('Quota'); } }, []), /Quota/);
});

function componentHarness(path, overrides = {}) {
  const slots = []; let cursor = 0, effects = [];
  const hooks = { ...React, default: React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) {
      effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    } },
  };
  const url = new URL(path, import.meta.url), require = createRequire(url), output = { exports: {} };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mocks = { react: hooks, '../lib/aiDock': aiDock, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../hooks/useBookmarkReorder': { useBookmarkReorder: (_ref, ids) => ({ order: ids, events: {}, onPointerDown() {} }) },
    './AIDockDialog': { AIDockDialog() {} }, './BookmarkMenu': { BookmarkMenu() {} }, ...overrides };
  new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? require(name), output, output.exports);
  const Component = Object.values(output.exports)[0];
  return { render(props = {}) { cursor = 0; effects = []; const tree = Component(props); effects.forEach((fn) => fn()); return tree; },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const chips = (tree) => tree.props.children[0].props.children[0].props.children[0];

test('middle-clicking a Local Hub chip opens its saved URL once in a new tab without autoscroll', () => {
  const previous = globalThis.window;
  for (const native of [false, true]) {
    const opens = [];
    globalThis.window = { localStorage: storage(), ...(native ? { __TAURI_INTERNALS__: {} } : {}) };
    if (native) aiDock.saveAiDock(window.localStorage,
      aiDock.putAiDockServer(aiDock.loadAiDock(window.localStorage), { ...draft, id: 'comfyui' }));
    const url = native ? 'http://localhost:7860' : 'http://localhost:8188';
    const harness = componentHarness('../src/components/LocalhostDock.tsx', {
      '@tauri-apps/api/event': { listen: async () => () => {} },
    });
    const pointer = button => ({ button, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    try {
      const tree = harness.render({ onOpenServer: (...args) => opens.push(args), onDialogChange() {} });
      const chip = chips(tree)[0];
      const down = pointer(1);
      chip.props.onMouseDown(down);
      assert.equal(down.prevented, true);
      assert.deepEqual(opens, []);
      const middle = pointer(1);
      chip.props.onAuxClick(middle);
      assert.equal(middle.prevented, true); assert.equal(middle.stopped, true);
      assert.deepEqual(opens, [[url, true]]);
      for (const button of [0, 2]) chip.props.onAuxClick(pointer(button));
      assert.equal(opens.length, 1);
      chip.props.onClick();
      assert.deepEqual(opens.at(-1), [url]);
    } finally { harness.dispose(); }
  }
  if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
});

test('Dock background and existing entries expose native Add/Edit/Delete menus and preserve launch behavior', async () => {
  const previous = globalThis.window, calls = [], opens = [], events = new Map(), dialogs = [];
  const store = storage();
  globalThis.window = { __TAURI_INTERNALS__: {}, localStorage: store };
  const harness = componentHarness('../src/components/LocalhostDock.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => calls.push({ command, args }) },
    '@tauri-apps/api/event': { listen: async (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
  });
  const props = { onOpenServer: (...args) => opens.push(args), onDialogChange: (open) => dialogs.push(open) };
  const context = () => ({ clientX: 12, clientY: 34, preventDefault() {}, stopPropagation() {} });
  try {
    let tree = harness.render(props);
    await tree.props.children[0].props.onContextMenu(context()); await settle();
    assert.deepEqual(calls.at(-1), { command: 'show_ai_dock_menu', args: { x: 12, y: 34, serverId: null } });
    await chips(tree)[0].props.onContextMenu(context()); await settle();
    assert.equal(calls.at(-1).args.serverId, 'comfyui');
    chips(tree)[0].props.onClick();
    chips(tree)[0].props.children[3].props.onClick({ stopPropagation() {} });
    assert.deepEqual(opens, [['http://localhost:8188'], ['http://localhost:8188', true]]);
    events.get('ai-dock-menu-select')({ payload: 'edit:comfyui' });
    assert.equal(calls.at(-1).command, 'show_ai_dock_editor');
    assert.equal(calls.at(-1).args.draft.name, 'ComfyUI');
    events.get('ai-dock-editor-closed')({});
    events.get('ai-dock-menu-select')({ payload: 'add' });
    assert.equal(calls.at(-1).args.draft.port, '');
    assert.equal(calls.at(-1).args.draft.id, undefined);
    events.get('ai-dock-editor-closed')({});
    assert.deepEqual(dialogs, [true, false, true, false]);
    const updated = aiDock.putAiDockServer(aiDock.loadAiDock(store), { ...draft, id: 'comfyui' });
    aiDock.saveAiDock(store, updated);
    events.get('ai-dock-changed')({});
    tree = harness.render(props);
    assert.equal(chips(tree)[0].props.children[0].props.style.backgroundColor, '#1234ab');
    chips(tree)[0].props.onClick(); assert.deepEqual(opens.at(-1), ['http://localhost:7860']);
    events.get('ai-dock-menu-select')({ payload: 'delete:ollama-api' });
    tree = harness.render(props);
    assert.equal(chips(tree).length, 3);
    assert.equal(aiDock.loadAiDock(store).some((server) => server.id === 'ollama-api'), false);
    tree.props.children[0].props.children[1].props.children[0].props.children[1].props.onChange({ target: { value: '7861' } });
    tree = harness.render(props);
    tree.props.children[0].props.children[1].props.onSubmit({ preventDefault() {} });
    assert.deepEqual(opens.at(-1), ['http://localhost:7861', true]);
    await settle(); harness.dispose(); assert.equal(events.size, 0);
  } finally { harness.dispose(); globalThis.window = previous; }
});

test('preview Add/Edit/Delete persists entries and failed saves preserve the displayed buttons', async () => {
  const previous = globalThis.window, store = storage(), dialogs = [];
  let fail = false;
  globalThis.window = { localStorage: { getItem: store.getItem, setItem: (...args) => { if (fail) throw new Error('Quota'); store.setItem(...args); } } };
  const harness = componentHarness('../src/components/LocalhostDock.tsx');
  const props = { onOpenServer() {}, onDialogChange: (open) => dialogs.push(open) };
  try {
    let tree = harness.render(props);
    tree.props.children[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 20 });
    tree = harness.render(props);
    assert.deepEqual(tree.props.children[1].props.menu.items.map((item) => item.id), ['add']);
    tree.props.children[1].props.onSelect('add');
    tree = harness.render(props);
    fail = true;
    assert.throws(() => tree.props.children[2].props.onSave(draft), /Unable to save/);
    assert.equal(chips(harness.render(props)).length, 4);
    fail = false;
    tree.props.children[2].props.onSave(draft);
    tree = harness.render(props);
    assert.equal(chips(tree).length, 5);
    const added = aiDock.loadAiDock(store).at(-1);
    chips(tree).at(-1).props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 20 });
    tree = harness.render(props);
    assert.deepEqual(tree.props.children[1].props.menu.items.map((item) => item.id), [`edit:${added.id}`, `delete:${added.id}`, 'add']);
    tree.props.children[1].props.onSelect(`edit:${added.id}`);
    tree = harness.render(props);
    assert.equal(tree.props.children[2].props.draft.port, '7860');
    tree.props.children[2].props.onSave({ ...draft, id: added.id, port: '7862', color: '#ef4444' });
    tree = harness.render(props);
    assert.equal(chips(tree).at(-1).props.children[0].props.style.backgroundColor, '#ef4444');
    chips(tree).at(-1).props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 20 });
    tree = harness.render(props);
    fail = true; tree.props.children[1].props.onSelect(`delete:${added.id}`);
    tree = harness.render(props);
    assert.equal(chips(tree).length, 5);
    assert.match(tree.props.children[0].props.children[2].props.children, /Unable to save/);
    assert.deepEqual(dialogs, [true, false, true, false]);
  } finally { harness.dispose(); globalThis.window = previous; }
});

test('Dock uses the bookmark drag strip, saves drops, and preserves the displayed order if saving fails', () => {
  const previous = globalThis.window, store = storage();
  let move, fail = false;
  globalThis.window = { localStorage: { getItem: store.getItem, setItem: (...args) => { if (fail) throw new Error('Quota'); store.setItem(...args); } } };
  const harness = componentHarness('../src/components/LocalhostDock.tsx', {
    '../hooks/useBookmarkReorder': { useBookmarkReorder: (_ref, ids, axis, onMove) => {
      assert.equal(axis, 'x'); move = onMove;
      return { order: ids, events: { onPointerMove() {} }, onPointerDown() {} };
    } },
  });
  const props = { onOpenServer() {}, onDialogChange() {} };
  try {
    let tree = harness.render(props);
    assert.equal(chips(tree)[0].props['data-bookmark-item'], 'comfyui');
    assert.ok(!JSON.stringify(tree).includes('Local AI Hub:'));
    assert.equal(typeof tree.props.children[0].props.children[0].props.onPointerMove, 'function');
    move('comfyui', 3);
    tree = harness.render(props);
    assert.deepEqual(chips(tree).map((chip) => chip.props['data-bookmark-item']), ['ollama-webui', 'ollama-api', 'pinokio', 'comfyui']);
    assert.deepEqual(aiDock.loadAiDock(store).map((server) => server.id), chips(tree).map((chip) => chip.props['data-bookmark-item']));
    fail = true; move('comfyui', 0);
    tree = harness.render(props);
    assert.equal(chips(tree).at(-1).props['data-bookmark-item'], 'comfyui');
    assert.match(tree.props.children[0].props.children[2].props.children, /Unable to save the Local Hub order/);
    assert.equal(aiDock.loadAiDock(store).at(-1).id, 'comfyui');
  } finally { harness.dispose(); globalThis.window = previous; }
});

test('the editor offers preset and custom colors and submits the selected color and fields', async () => {
  let saved;
  const harness = componentHarness('../src/components/AIDockDialog.tsx');
  const props = { draft, standalone: true, onClose() {}, onSave: (value) => { saved = value; } };
  try {
    let tree = harness.render(props), form = tree.props.children;
    const fields = form.props.children[1].props.children;
    assert.equal(fields[1].props.children[1].props.min, 1);
    assert.equal(fields[1].props.children[1].props.max, 65535);
    const presets = fields[3].props.children[1].props.children;
    assert.equal(presets.length, 8);
    presets[0].props.onClick();
    tree = harness.render(props); form = tree.props.children;
    assert.equal(form.props.children[1].props.children[3].props.children[1].props.children[0].props['aria-pressed'], true);
    form.props.children[1].props.children[3].props.children[2].props.children[1].props.onChange({ target: { value: '#abcdef' } });
    tree = harness.render(props);
    await tree.props.children.props.onSubmit({ preventDefault() {} });
    assert.equal(saved.color, '#abcdef'); assert.equal(saved.name, draft.name); assert.equal(saved.port, '7860');
  } finally { harness.dispose(); }
});

test('native editor persists before notifying main, survives storage failures and does not duplicate a retried save', async () => {
  const previous = globalThis.window, store = storage(), log = [];
  let fail = true, notifyFails = false;
  globalThis.window = { localStorage: { getItem: store.getItem, setItem: (...args) => { if (fail) throw new Error('Quota'); log.push('persist'); store.setItem(...args); } } };
  const harness = componentHarness('../src/components/AIDockEditorWindow.tsx', {
    '@tauri-apps/api/core': { invoke: async (command) => { if (command === 'get_ai_dock_editor') return draft; log.push(command); } },
    '@tauri-apps/api/event': { emitTo: async (_window, name) => { if (notifyFails) throw new Error('notify'); log.push(name); } },
  });
  try {
    harness.render(); await settle();
    const dialog = harness.render().props.children[0].props;
    assert.equal(dialog.standalone, true);
    await assert.rejects(() => dialog.onSave(draft), /Unable to save/);
    assert.deepEqual(log, []);
    fail = false; notifyFails = true;
    await assert.rejects(() => dialog.onSave(draft), /notify/);
    notifyFails = false; log.length = 0;
    await dialog.onSave(draft);
    assert.deepEqual(log, ['persist', 'ai-dock-changed', 'close_ai_dock_editor']);
    assert.equal(aiDock.loadAiDock(store).length, 5);
  } finally { harness.dispose(); globalThis.window = previous; }
});
