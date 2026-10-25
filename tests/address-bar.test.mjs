import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import { resolveAddress } from '../src/lib/address.ts';

function harness() {
  const slots = [], effects = [];
  let cursor = 0, dirty = false, tree, input;
  const calls = { focused: 0, selected: 0, navigated: [], applied: [] };
  const props = { url: 'https://example.com/original', canGoBack: false, canGoForward: false,
    onNavigate: (url) => calls.navigated.push(url), onGoBack() {}, onGoForward() {}, onReload() {}, onGoHome() {},
    onFillApplied: (id) => calls.applied.push(id) };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { const value = typeof next === 'function' ? next(slots[index]) : next;
        if (value !== slots[index]) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) { slots[index] = deps; effects.push(fn); } },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/AddressBar.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const output = { exports: {} };
  const require = (name) => {
    if (name === 'react') return hooks;
    if (name === '../lib/address') return { resolveAddress };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => React.createElement(type, props), jsxs: (type, props) => React.createElement(type, props) };
    assert.fail(`Unexpected import ${name}`);
  };
  new Function('require', 'module', 'exports', code)(require, output, output.exports);
  const find = (node, type) => node?.type === type ? node : React.Children.toArray(node?.props?.children).map((child) => find(child, type)).find(Boolean);
  const render = (next = {}) => {
    Object.assign(props, next);
    let iterations = 0;
    do {
      assert.ok(++iterations < 15); dirty = false; cursor = 0;
      tree = output.exports.AddressBar(props); input = find(tree, 'input');
      input.ref.current = { focus() { calls.focused++; input.props.onFocus({ target: { select() { calls.selected++; } } }); }, select() { calls.selected++; } };
      effects.splice(0).forEach((fn) => fn());
    } while (dirty);
  };
  render();
  return { calls, render, get input() { return input; }, submit() { find(tree, 'form').props.onSubmit({ preventDefault() {} }); } };
}

test('selected text replaces the address without navigation and survives page status updates or further typing', () => {
  const h = harness(), text = 'selected text & Unicode 中文';
  h.render({ fillRequest: { id: 'selection-1', text } });
  assert.equal(h.input.props.value, text);
  assert.equal(h.calls.focused, 1);
  assert.deepEqual(h.calls.applied, ['selection-1']);
  assert.deepEqual(h.calls.navigated, []);
  h.render({ fillRequest: undefined, url: 'https://example.com/redirected' });
  assert.equal(h.input.props.value, text, 'page navigation must not replace the selected text being edited');
  h.input.props.onChange({ target: { value: 'edited query' } }); h.render();
  assert.equal(h.input.props.value, 'edited query');
  assert.equal(h.calls.focused, 1);
  h.submit(); assert.equal(h.calls.navigated.length, 1, 'only submitting navigates');
});

test('split address waits until its native layout enables editing and handles repeated identical selections', () => {
  const h = harness();
  h.render({ disabled: true, fillRequest: { id: 'selection-1', text: 'https://example.com/selected' } });
  assert.equal(h.calls.focused, 0); assert.deepEqual(h.calls.applied, []);
  h.render({ disabled: false });
  assert.equal(h.calls.focused, 1); assert.deepEqual(h.calls.applied, ['selection-1']);
  h.render({ fillRequest: { id: 'selection-2', text: 'https://example.com/selected' } });
  assert.equal(h.calls.focused, 2); assert.deepEqual(h.calls.applied, ['selection-1', 'selection-2']);
  assert.deepEqual(h.calls.navigated, []);
});
