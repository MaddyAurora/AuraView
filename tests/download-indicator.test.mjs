import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as progress from '../src/lib/downloadProgress.ts';

const item = (started, downloaded, total, status = 'downloading') => ({ id: `file:${started}`, started, downloaded, total, status, revision: started });
test('combined progress is weighted by bytes, retains finished batch members and resets for the next batch', () => {
  const old = item(0, 10000, 10000, 'saved');
  let batch = progress.downloadBatch({ started: null, percent: null }, [old, item(1, 50, 100), item(2, 50, 300)]);
  assert.equal(batch.percent, 25);
  batch = progress.downloadBatch(batch, [old, item(1, 100, 100, 'saved'), item(2, 50, 300)]);
  assert.equal(batch.percent, 37.5, 'the finished file still contributes to total progress');
  assert.equal(progress.downloadBatch(batch, [old, item(1, 100, 100, 'deleted'), item(2, 50, 300)]).percent, 37.5, 'recycling a completed file does not undo its download progress');
  batch = progress.downloadBatch(batch, [item(1, 100, 100, 'saved'), item(2, 300, 300, 'saved')]);
  assert.equal(batch.started, null);
  batch = progress.downloadBatch(batch, [old, item(1, 100, 100, 'saved'), item(3, 50, 100)]);
  assert.equal(batch.percent, 50, 'a new batch must not inherit the previous completed files');
  assert.equal(progress.downloadBatch(batch, [item(3, 500, 100)]).percent, 100);
});
test('unknown active sizes stay indeterminate while completed empty files remain valid', () => {
  const initial = { started: null, percent: null };
  assert.equal(progress.downloadBatch(initial, [item(1, 10, 100), item(2, 20, undefined)]).percent, null);
  assert.equal(progress.downloadBatch(initial, [item(1, 10, 0)]).percent, null);
  assert.equal(progress.downloadBatch({ started: 1, percent: 0 }, [item(1, 0, 0, 'saved'), item(2, 50, 100)]).percent, 50);
});

function indicator() {
  const slots = [], timers = new Map();
  let cursor = 0, dirty = false, effects = [], now = 10000, nextTimer = 0, downloads = [], value;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => {
        const result = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(result, slots[index])) { slots[index] = result; dirty = true; }
      }];
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push(() => {
        previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() };
      });
    },
  };
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/Downloads.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const require = (name) => {
    if (name === 'react') return hooks;
    if (name === '../lib/downloadProgress') return progress;
    if (name === 'react/jsx-runtime' || name === 'lucide-react' || name.startsWith('@tauri-apps/')) return {};
    assert.fail(`Unexpected import ${name}`);
  };
  new Function('require', 'module', 'exports', 'Date', 'setTimeout', 'clearTimeout', code)(require, output, output.exports,
    { now: () => now }, (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; }, (id) => timers.delete(id));
  const flush = () => {
    let iterations = 0;
    do {
      assert.ok(++iterations < 20, 'indicator effects must settle');
      cursor = 0; dirty = false; effects = [];
      value = output.exports.useDownloadIndicator(downloads); effects.forEach((fn) => fn());
    } while (dirty);
    return value;
  };
  return {
    update(items) { downloads = items; return flush(); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); flush();
      }
      now = until; return flush();
    },
    get now() { return now; },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); assert.equal(timers.size, 0); },
  };
}
test('completion feedback lasts five seconds, ignores history and yields to new transfers or errors', () => {
  const h = indicator();
  try {
    assert.equal(h.update([item(1, 100, 100, 'saved')]).complete, false);
    let saved = { ...item(2, 100, 100, 'saved'), completedAt: h.now };
    assert.equal(h.update([saved]).complete, true);
    assert.equal(h.advance(4999).complete, true);
    assert.equal(h.advance(1).complete, false);
    saved = { ...item(3, 100, 100, 'saved'), completedAt: h.now };
    assert.equal(h.update([saved]).complete, true);
    assert.equal(h.update([saved, item(4, 50, 100)]).complete, false);
    assert.equal(h.update([saved, item(4, 50, 100, 'error')]).complete, false);
    saved = { ...item(5, 100, 100, 'saved'), completedAt: h.now };
    assert.equal(h.update([saved]).complete, true);
    h.advance(3000);
    const second = { ...item(6, 100, 100, 'saved'), completedAt: h.now };
    assert.equal(h.update([saved, second]).complete, true);
    assert.equal(h.advance(4999).complete, true);
    assert.equal(h.advance(1).complete, false, 'a newer completion gets its own five-second window');
  } finally { h.dispose(); }
});
