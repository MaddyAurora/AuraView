import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { overflowEntries } from '../src/lib/tabOverflow.ts';
import { createTab } from '../src/lib/tabState.ts';

test('the popup subscribes before reading, rejects older data, and acknowledges the rendered list', async () => {
  const slots = [], effects = [], commands = [];
  let cursor = 0, resolveRead, unsubscribed = 0;
  const handlers = new Map();
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const mocks = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '@tauri-apps/api/event': { listen: async (name, next) => {
      handlers.set(name, next); return () => { unsubscribed++; };
    } },
    '@tauri-apps/api/core': { invoke: (command, args) => {
      commands.push([command, args]);
      if (command === 'get_tab_overflow') {
        assert.equal(handlers.size, 2, 'subscribe to updates and dismissal before the initial read');
        return new Promise(resolve => { resolveRead = resolve; });
      }
      return Promise.resolve();
    } },
    './TabOverflowMenu': { TabOverflowMenu: 'menu' },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/components/TabOverflowWindow.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => mocks[name] ?? assert.fail(`Unexpected import ${name}`), module, module.exports);
  const render = () => {
    cursor = 0;
    const result = module.exports.TabOverflowWindow();
    effects.splice(0).forEach(effect => effect());
    return result;
  };
  const tabs = overflowEntries([createTab('hidden')]);
  const snapshot = requestId => ({ tabs, activeTabId: 'hidden', requestId, openingId: 1 });
  render();
  await new Promise(resolve => setImmediate(resolve));
  const handler = handlers.get('tab-overflow-updated');
  handler({ payload: snapshot(3) });
  resolveRead(snapshot(1));
  await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  assert.equal(tree.props.children[0].key, 1);
  assert.deepEqual(commands.at(-1), ['tab_overflow_ready', { requestId: 3 }]);
  assert.equal(tree.props.children[0].props.autoCloseEnabled, false, 'the timer waits until the popup is shown');
  await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(tree.props.children[0].props.autoCloseEnabled, true);
  tree.props.children[0].props.onAutoClose();
  assert.deepEqual(commands.at(-1), ['close_tab_overflow', { restoreFocus: false, openingId: 1 }]);
  tree.props.children[0].props.onSelect('hidden');
  assert.deepEqual(commands.at(-1), ['select_overflow_tab', { tabId: 'hidden', requestId: 3 }]);
  tree.props.children[0].props.onCloseTab('hidden');
  assert.deepEqual(commands.at(-1), ['close_overflow_tab', { tabId: 'hidden', requestId: 3 }]);
  handler({ payload: snapshot(2) });
  tree = render();
  assert.equal(tree.props.children[0].props.entries, tabs);
  handler({ payload: snapshot(4) });
  tree = render();
  assert.deepEqual(commands.at(-1), ['tab_overflow_ready', { requestId: 4 }]);
  assert.equal(tree.props.children[0].key, 1, 'metadata updates preserve the mounted list and scroll position');
  handlers.get('tab-overflow-dismissed')({ payload: 1 });
  tree = render();
  assert.equal(tree.props.children[0].props.autoCloseEnabled, false, 'hiding the reusable window cancels the timer');
  handler({ payload: snapshot(4) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().props.children[0].props.autoCloseEnabled, false, 'late readiness cannot restart a dismissed timer');
  handler({ payload: { ...snapshot(5), openingId: 5 } });
  tree = render();
  assert.equal(tree.props.children[0].key, 5, 'reopening focuses the active tab afresh');
  assert.equal(tree.props.children[0].props.autoCloseEnabled, false);
  await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(tree.props.children[0].props.autoCloseEnabled, true);
  tree.props.children[0].props.onClose();
  assert.deepEqual(commands.at(-1), ['close_tab_overflow', { restoreFocus: true, openingId: 5 }]);
  slots.forEach(slot => slot?.cleanup?.());
  assert.equal(unsubscribed, 2);
});
