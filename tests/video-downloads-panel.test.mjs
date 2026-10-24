import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';
import * as downloadProgress from '../src/lib/downloadProgress.ts';

function harness() {
  const slots = [], effects = new Map(); let cursor = 0, callback, resolveSnapshot, stopped = false, disposed = false;
  const calls = [], handlers = new Map();
  const code = ts.transpileModule(readFileSync(new URL('../src/components/Downloads.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const output = { exports: {} };
  const previousWindow = globalThis.window; globalThis.window = { __TAURI_INTERNALS__: {} };
  const require = (name) => {
    if (name === '../lib/downloadProgress') return downloadProgress;
    if (name === 'react') return { useState: (initial) => {
      const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    }, useEffect: (effect, deps) => {
      const index = cursor++, previous = effects.get(index);
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.(); effects.set(index, { deps, cleanup: effect() });
      }
    } };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => React.createElement(type, props), jsxs: (type, props) => React.createElement(type, props) };
    if (name === '@tauri-apps/api/core') return { invoke: (command, args) => { calls.push({ command, args }); return command === 'list_downloads' ? new Promise((resolve) => { resolveSnapshot = resolve; }) : Promise.resolve(); } };
    if (name === '@tauri-apps/api/event') return { listen: async (name, handler) => { handlers.set(name, handler); if (name === 'download-progress') callback = handler; return () => { stopped = true; }; } };
    if (name === 'lucide-react') return Object.fromEntries(['Check', 'Download', 'FolderOpen', 'RotateCw', 'Trash2', 'X'].map((name) => [name, () => null]));
    assert.fail(`Unexpected import ${name}`);
  };
  new Function('require', 'module', 'exports', code)(require, output, output.exports);
  return { api: output.exports, calls, get downloads() { return slots[0]; },
    panel(props) { cursor = 0; return output.exports.Downloads(props); },
    event: (payload) => callback({ payload }), snapshot: (items) => resolveSnapshot(items),
    clear: (entries = [], revision = 3) => handlers.get('downloads-history-cleared')({ payload: { entries, revision } }),
    get stopped() { return stopped; },
    dispose() { if (disposed) return; disposed = true; for (const effect of effects.values()) effect.cleanup?.();
      if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const job = (revision, status = 'downloading') => ({ id: 'video:selected-video', kind: 'video', title: 'Selected video', started: 1, revision, status, message: status, downloaded: 1234, total: null, percent: null, cancelable: true, retryable: true });

test('clearing history removes completed downloads, preserves active transfers and rejects stale snapshots', async () => {
  const h = harness();
  try {
    h.api.useDownloads(); await settle();
    const active = job(2), saved = { ...job(3, 'saved'), id: 'image:old' };
    h.event(active); h.event(saved);
    h.clear([active]);
    h.snapshot([saved]); await settle();
    assert.deepEqual(h.downloads.map((item) => item.id), [active.id]);
    h.event(saved);
    assert.deepEqual(h.downloads.map((item) => item.id), [active.id], 'a delayed completion event cannot restore cleared history');
    h.event(job(4, 'saved'));
    assert.equal(h.downloads[0].status, 'saved', 'the active transfer can still finish normally');
  } finally { h.dispose(); }
});

test('download events win over an older snapshot and stop after the panel owner unmounts', async () => {
  const h = harness();
  try {
    h.api.useDownloads(); await settle();
    assert.equal(h.calls[0].command, 'list_downloads');
    h.event(job(3, 'saved')); h.snapshot([job(1)]); await settle();
    assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].status, 'saved');
    h.event(job(2)); assert.equal(h.downloads[0].revision, 3);
    h.dispose(); assert.equal(h.stopped, true);
    h.event(job(4, 'error')); assert.equal(h.downloads[0].status, 'saved');
  } finally { h.dispose(); }
});

test('the visible panel sends cancellation and retry to their exact native job', async () => {
  const h = harness();
  try {
    const tree = h.api.Downloads({ downloads: [job(1), { ...job(2, 'error'), id: 'browser:failed-file', kind: 'browser' },
      { ...job(3, 'error'), id: 'image:failed-photo', kind: 'image', cancelable: false, retryable: false }], onClose() {} });
    const buttons = [];
    function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'button') buttons.push(node);
      for (const child of React.Children.toArray(node.props?.children)) visit(child); }
    visit(tree);
    buttons.find((b) => b.props.title === 'Cancel download').props.onClick();
    buttons.find((b) => b.props.title === 'Retry download').props.onClick(); await settle();
    assert.deepEqual(h.calls, [
      { command: 'cancel_download', args: { id: 'video:selected-video' } },
      { command: 'retry_download', args: { id: 'browser:failed-file' } },
    ]);
    assert.equal(buttons.filter((b) => b.props.title === 'Retry download').length, 1, 'images do not expose an unsupported retry command');
    assert.equal(tree.props['aria-label'], 'Downloads');
  } finally { h.dispose(); }
});

test('hover history is read-only while the pinned panel retains file actions', () => {
  const h = harness();
  try {
    const tree = h.panel({ downloads: [{ ...job(1, 'saved'), hasFile: true, redownloadable: true }], preview: true, onClose() {} });
    const buttons = [];
    const visit = (node) => { if (!node || typeof node !== 'object') return; if (node.type === 'button') buttons.push(node);
      for (const child of React.Children.toArray(node.props?.children)) visit(child); };
    visit(tree);
    assert.deepEqual(buttons, []);
    assert.deepEqual(h.calls, []);
  } finally { h.dispose(); }
});

test('history and hover preview show the same average speed and ETA, then clear them when merging', () => {
  const h = harness();
  const text = (node) => typeof node === 'string' || typeof node === 'number' ? String(node)
    : node && typeof node === 'object' ? React.Children.toArray(node.props?.children).map(text).join(' ') : '';
  try {
    const item = { ...job(1), downloaded: 1024 * 1024, total: 11 * 1024 * 1024,
      bytesPerSecond: 1024 * 1024, remainingSeconds: 10, estimateUpdatedAt: Date.now() };
    for (const preview of [false, true]) {
      const rendered = text(h.panel({ downloads: [item], preview, onClose() {} }));
      assert.match(rendered, /1\.0 MB\/s avg · About 10s left/);
      assert.match(rendered, /1\.0 MB \/ 11\.0 MB/);
    }
    assert.doesNotMatch(text(h.panel({ downloads: [{ ...item, status: 'merging' }], onClose() {} })), /MB\/s|left/);
    assert.doesNotMatch(text(h.panel({ downloads: [{ ...item, estimateUpdatedAt: Date.now() - 11_000 }], preview: true, onClose() {} })), /10s left/);
    assert.deepEqual(h.calls, [], 'showing estimates makes no native action requests');
  } finally { h.dispose(); }
});

test('images, videos and files share chronological history even when progress arrives out of order', async () => {
  const h = harness();
  try {
    h.api.useDownloads(); await settle();
    h.event({ ...job(5), id: 'browser:file', kind: 'browser', started: 4 });
    h.event({ ...job(8, 'saved'), id: 'image:photo', kind: 'image', started: 2 });
    h.snapshot([{ ...job(3), started: 1 }, { ...job(2), id: 'image:photo', kind: 'image', started: 2 }]);
    await settle();
    assert.deepEqual(h.downloads.map((item) => item.id), ['video:selected-video', 'image:photo', 'browser:file']);
    assert.equal(h.downloads[1].status, 'saved', 'a stale snapshot cannot revert a completed image');
    for (let i = 0; i < 70; i++) h.event({ ...job(10 + i, 'saved'), id: `image:${i}`, kind: 'image', started: 10 + i });
    assert.equal(h.downloads.filter((item) => item.status === 'saved').length, 60);
    assert.ok(h.downloads.some((item) => item.id === 'browser:file'), 'small completed files cannot evict an active file');
    assert.ok(h.downloads.some((item) => item.id === 'video:selected-video'));
  } finally { h.dispose(); }
});

test('only live saved events carry completion feedback and finalizing videos retain their byte totals', async () => {
  const h = harness();
  try {
    h.api.useDownloads(); await settle();
    h.snapshot([job(1, 'saved')]); await settle();
    assert.equal(h.downloads[0].completedAt, undefined, 'opening the app must not celebrate historical downloads');
    h.event(job(1, 'saved'));
    assert.ok(h.downloads[0].completedAt, 'a live event can follow a snapshot of the same revision');
    const completedAt = h.downloads[0].completedAt;
    h.event(job(1, 'saved')); assert.equal(h.downloads[0].completedAt, completedAt);
    h.event({ ...job(2), total: 400, downloaded: 100 });
    h.event({ ...job(3, 'merging'), total: null, downloaded: 0 });
    assert.equal(h.downloads[0].total, 400); assert.equal(h.downloads[0].downloaded, 400);
    h.event({ ...job(4, 'saved'), total: null, downloaded: 0 });
    assert.equal(h.downloads[0].total, 400); assert.equal(h.downloads[0].downloaded, 400);
    assert.ok(h.downloads[0].completedAt);
  } finally { h.dispose(); }
});

test('completed files expose folder, new-copy download and Recycle Bin actions by history id only', async () => {
  const h = harness();
  const items = [
    { ...job(1, 'saved'), id: 'image:photo', filename: 'photo.png', hasFile: true, redownloadable: true },
    { ...job(2, 'deleted'), id: 'browser:archive', filename: 'archive.zip', hasFile: true, fileDeleted: true, redownloadable: true },
    { ...job(3), id: 'browser:active-file' },
  ];
  const buttons = (tree) => {
    const result = [];
    function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'button') result.push(node);
      for (const child of React.Children.toArray(node.props?.children)) visit(child); }
    visit(tree); return result;
  };
  try {
    let rendered = buttons(h.panel({ downloads: items, onClose() {} }));
    assert.equal(rendered.filter((button) => button.props.title === 'Show in folder').length, 2);
    assert.equal(rendered.filter((button) => button.props.title === 'Delete file (Recycle Bin)').length, 1);
    rendered.find((button) => button.props['aria-label'] === 'Show photo.png in folder').props.onClick();
    rendered = buttons(h.panel({ downloads: items, onClose() {} }));
    assert.equal(rendered.find((button) => button.props['aria-label'] === 'Delete photo.png').props.disabled, true, 'disable file actions while its folder action is pending');
    await settle();
    rendered = buttons(h.panel({ downloads: items, onClose() {} }));
    rendered.find((button) => button.props['aria-label'] === 'Delete photo.png').props.onClick(); await settle();
    rendered = buttons(h.panel({ downloads: items, onClose() {} }));
    rendered.find((button) => button.props['aria-label'] === 'Download archive.zip again').props.onClick(); await settle();
    assert.deepEqual(h.calls, [
      { command: 'reveal_download', args: { id: 'image:photo' } },
      { command: 'delete_download', args: { id: 'image:photo' } },
      { command: 'redownload_download', args: { id: 'browser:archive' } },
    ]);
  } finally { h.dispose(); }
});
