import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import { fakeClock } from './fixtures/fake-clock.mjs';

function harness() {
  const clock = fakeClock(), slots = [], effects = new Map(), calls = [], pending = [];
  let cursor = 0, dirty = false, tree;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = effects.get(index);
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) { previous?.cleanup?.(); effects.set(index, { deps, cleanup: effect() }); } },
  };
  const invoke = (command, args) => {
    calls.push({ command, args });
    if (command === 'get_browser_settings') return Promise.resolve({ keepHistory: true });
    if (command === 'clear_browser_data' || command === 'set_keep_history') return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    return Promise.resolve();
  };
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/BrowserSettings.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const require = (name) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => React.createElement(type, props), jsxs: (type, props) => React.createElement(type, props) };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@tauri-apps/api/core') return { invoke };
    if (name === '@tauri-apps/api/event') return { listen: async () => () => {} };
    assert.fail(`Unexpected import ${name}`);
  };
  const window = { addEventListener() {}, removeEventListener() {} };
  new Function('require', 'module', 'exports', 'window', 'setTimeout', 'clearTimeout', code)(require, output, output.exports, window, clock.setTimeout, clock.clearTimeout);
  const render = () => { let attempts = 0; do { assert.ok(++attempts < 20); cursor = 0; dirty = false; tree = output.exports.BrowserSettingsWindow(); } while (dirty); return tree; };
  const nodes = (predicate) => { const found = []; const visit = (node) => { if (!node || typeof node !== 'object') return;
    if (predicate(node)) found.push(node); React.Children.toArray(node.props?.children).forEach(visit); }; visit(render()); return found; };
  const text = (node) => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? React.Children.toArray(node.props?.children).map(text).join(' ') : '';
  return { clock, calls, pending, render, text, nodes,
    button(label) { return nodes((node) => node.type === 'button' && text(node).includes(label))[0]; },
    dispose() { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('cleanup stays pending until native completion, then turns green for exactly five seconds', async () => {
  const h = harness();
  try {
    h.render(); await settle();
    h.button('Clear browser history').props.onClick();
    assert.equal(h.calls.at(-1).command, 'clear_browser_data');
    assert.deepEqual(h.calls.at(-1).args, { action: 'history' });
    assert.equal(h.button('Clear cookies').props.disabled, true);
    assert.doesNotMatch(h.button('Clear browser history').props.className, /emerald/);
    h.pending.shift().resolve(); await settle();
    assert.match(h.button('Clear browser history').props.className, /emerald/);
    h.clock.advance(4999); assert.match(h.button('Clear browser history').props.className, /emerald/);
    h.clock.advance(1); assert.doesNotMatch(h.button('Clear browser history').props.className, /emerald/);
  } finally { h.dispose(); }
});

test('failed cleanup shows an error without success feedback, and cookies/sessions use distinct actions', async () => {
  const h = harness();
  try {
    h.render(); await settle();
    h.button('Clear cookies').props.onClick();
    assert.deepEqual(h.calls.at(-1).args, { action: 'cookies' });
    h.pending.shift().reject(new Error('Cleanup failed')); await settle();
    assert.match(h.text(h.nodes((node) => node.props.role === 'alert')[0]), /Cleanup failed/);
    assert.doesNotMatch(h.button('Clear cookies').props.className, /emerald/);
    h.button('Clear login sessions').props.onClick();
    assert.deepEqual(h.calls.at(-1).args, { action: 'sessions' });
    h.pending.shift().resolve(); await settle();
    assert.match(h.button('Clear login sessions').props.className, /emerald/);
  } finally { h.dispose(); }
});

test('history retention changes only after native confirmation and History opens the page', async () => {
  const h = harness();
  try {
    h.render(); await settle();
    h.button('Keep URL history').props.onClick();
    assert.deepEqual(h.calls.at(-1), { command: 'set_keep_history', args: { enabled: false } });
    assert.equal(h.button('Keep URL history').props['aria-checked'], true);
    h.pending.shift().resolve({ keepHistory: false }); await settle();
    assert.equal(h.button('Keep URL history').props['aria-checked'], false);
    h.button('View visited pages').props.onClick(); await settle();
    assert.equal(h.calls.at(-1).command, 'open_browser_history');
  } finally { h.dispose(); }
});
