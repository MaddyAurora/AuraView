import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function harness(hovered = false) {
  const slots = [], timers = new Map();
  let cursor = 0, now = 0, nextTimer = 0, enabled = true, handlers;
  const closed = [], effects = [];
  const root = { matches: selector => { assert.equal(selector, ':hover'); return hovered; } };
  const hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: index === 0 ? root : initial }; },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useMenuAutoClose.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', compiled)(
    name => name === 'react' ? hooks : assert.fail(name), module, module.exports,
    (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; },
    id => timers.delete(id),
  );
  const h = {
    closed,
    render(active = enabled, callback = () => closed.push(now)) {
      enabled = active; cursor = 0;
      handlers = module.exports.useMenuAutoClose(callback, enabled);
      effects.splice(0).forEach(effect => effect());
      return handlers;
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
    enter() { hovered = true; handlers.onMouseEnter(); },
    leave() { hovered = false; handlers.onMouseLeave(); },
    key() { handlers.onKeyDown(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render();
  return h;
}

test('a menu left outside the pointer closes after exactly one second', () => {
  const h = harness();
  h.advance(999); assert.deepEqual(h.closed, []);
  h.advance(1); assert.deepEqual(h.closed, [1000]);
  h.dispose();
});

test('entering cancels dismissal and leaving or re-entering starts a fresh one second', () => {
  const h = harness();
  h.advance(500); h.enter(); h.advance(10_000);
  assert.deepEqual(h.closed, []);
  h.leave(); h.advance(999); assert.deepEqual(h.closed, []);
  h.enter(); h.advance(100); h.leave(); h.advance(1000);
  assert.equal(h.closed.length, 1);
  h.dispose();
});

test('opening beneath the pointer and keyboard activity preserve interaction time', () => {
  const h = harness(true);
  h.advance(5000); assert.deepEqual(h.closed, []);
  h.leave(); h.advance(500); h.key(); h.advance(999);
  assert.deepEqual(h.closed, []);
  h.advance(1); assert.equal(h.closed.length, 1);
  h.dispose();
});

test('metadata changes do not reset the timer, while hiding and unmounting cancel it', () => {
  const h = harness();
  let latestCalled = false;
  h.advance(500); h.render(true, () => { latestCalled = true; });
  h.advance(500); assert.equal(latestCalled, true);
  h.render(false); h.advance(5000); assert.deepEqual(h.closed, []);
  h.render(true); h.advance(999); assert.deepEqual(h.closed, []);
  h.render(false); h.advance(1); assert.deepEqual(h.closed, []);
  h.render(true); h.dispose(); h.advance(1000); assert.deepEqual(h.closed, []);
});
