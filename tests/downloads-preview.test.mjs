import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';

function harness(native = true, component = 'DownloadsPreview') {
  const previous = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const slots = [], calls = [], observers = [], listeners = new Map();
  let cursor = 0, effects = [], ready, disposed = false;
  globalThis.window = { ...(native ? { __TAURI_INTERNALS__: {} } : {}), innerHeight: 800,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  globalThis.ResizeObserver = class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} disconnect() {} };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) effects.push(() => {
      slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
    }); },
  };
  const url = new URL('../src/components/DownloadsPreview.tsx', import.meta.url), require = createRequire(url), output = { exports: {} };
  const mocks = { react: hooks, '@tauri-apps/api/core': { invoke: async (name, args) => { calls.push({ name, args }); } },
    './Downloads': { Downloads() {}, useDownloads: (onReady) => { ready = onReady; return []; } } };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? require(name), output, output.exports);
  return { calls, observers, loaded: () => ready(),
    render(props) { cursor = 0; effects = []; const tree = output.exports[component](props); effects.forEach((fn) => fn()); return tree; },
    dispose() { if (disposed) return; disposed = true; slots.forEach((slot) => slot?.cleanup?.()); Object.assign(globalThis, previous); } };
}
const anchor = { current: { getBoundingClientRect: () => ({ left: 0, bottom: 76, width: 1200 }) } };

test('native hover preview changes only its overlay bounds and closes on rapid leave or pinning', () => {
  const h = harness();
  try {
    const props = { visible: false, anchor, downloads: [] };
    assert.equal(h.render(props), null);
    for (let repeat = 0; repeat < 8; repeat++) {
      assert.equal(h.render({ ...props, visible: true }), null, 'native preview inserts no HTML into the main layout');
      assert.deepEqual(h.calls.at(-1).args.bounds, { x: 0, y: 76, width: 1200, height: 94 });
      h.render(props);
      assert.equal(h.calls.at(-1).args.bounds, null);
    }
    h.render({ ...props, visible: true, downloads: Array(20).fill({}) });
    assert.ok(h.calls.at(-1).args.bounds.height <= 210);
    const requests = h.calls.map((call) => call.args.requestId);
    assert.ok(requests.every((id, i) => i === 0 || id > requests[i - 1]), 'requests must be ordered so late shows can be ignored');
    assert.ok(h.calls.every((call) => call.name === 'set_downloads_preview'));
    h.dispose();
    assert.equal(h.calls.at(-1).args.bounds, null);
  } finally { h.dispose(); }
});

test('browser preview uses a fixed passive overlay and never a panel in document flow', () => {
  const h = harness(false);
  try {
    const props = { visible: true, anchor, downloads: [] };
    h.render(props);
    const tree = h.render(props);
    assert.match(tree.props.className, /fixed/);
    assert.match(tree.props.className, /pointer-events-none/);
    assert.equal(tree.props.children.props.preview, true);
    assert.deepEqual(tree.props.style, { left: 0, top: 76, width: 1200, height: 94 });
    assert.equal(h.render({ ...props, visible: false }), null);
    assert.deepEqual(h.calls, []);
  } finally { h.dispose(); }
});

test('native preview signals readiness only after its history has loaded', () => {
  const h = harness(true, 'DownloadsPreviewWindow');
  try {
    const tree = h.render();
    assert.equal(tree.props.children.props.preview, true);
    assert.deepEqual(h.calls, []);
    h.loaded(); h.render();
    assert.deepEqual(h.calls, [{ name: 'downloads_preview_ready', args: undefined }]);
  } finally { h.dispose(); }
});
