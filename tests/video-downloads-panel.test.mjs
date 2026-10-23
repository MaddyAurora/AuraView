import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';

function harness() {
  let downloads = [], cleanup, callback, resolveSnapshot, stopped = false;
  const calls = [];
  const code = ts.transpileModule(readFileSync(new URL('../src/components/VideoDownloads.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const output = { exports: {} };
  const previousWindow = globalThis.window; globalThis.window = { __TAURI_INTERNALS__: {} };
  const require = (name) => {
    if (name === 'react') return { useState: () => [downloads, (next) => { downloads = typeof next === 'function' ? next(downloads) : next; }], useEffect: (effect) => { cleanup = effect(); } };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => React.createElement(type, props), jsxs: (type, props) => React.createElement(type, props) };
    if (name === '@tauri-apps/api/core') return { invoke: (command, args) => { calls.push({ command, args }); return command === 'list_video_downloads' ? new Promise((resolve) => { resolveSnapshot = resolve; }) : Promise.resolve(); } };
    if (name === '@tauri-apps/api/event') return { listen: async (_, handler) => { callback = handler; return () => { stopped = true; }; } };
    if (name === 'lucide-react') return Object.fromEntries(['Check', 'Download', 'RotateCw', 'X'].map((name) => [name, () => null]));
    assert.fail(`Unexpected import ${name}`);
  };
  new Function('require', 'module', 'exports', code)(require, output, output.exports);
  return { api: output.exports, calls, get downloads() { return downloads; },
    event: (payload) => callback({ payload }), snapshot: (items) => resolveSnapshot(items),
    get stopped() { return stopped; },
    dispose() { cleanup?.(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const job = (revision, status = 'downloading') => ({ id: 'selected-video', title: 'Selected video', revision, status, message: status, downloaded: 1234, total: null, percent: null });

test('download events win over an older snapshot and stop after the panel owner unmounts', async () => {
  const h = harness();
  try {
    h.api.useVideoDownloads(); await settle();
    assert.equal(h.calls[0].command, 'list_video_downloads');
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
    const tree = h.api.VideoDownloads({ downloads: [job(1), { ...job(2, 'error'), id: 'failed-video' }], onClose() {} });
    const buttons = [];
    function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'button') buttons.push(node);
      for (const child of React.Children.toArray(node.props?.children)) visit(child); }
    visit(tree);
    buttons.find((b) => b.props.title === 'Cancel download').props.onClick();
    buttons.find((b) => b.props.title === 'Retry download').props.onClick(); await settle();
    assert.deepEqual(h.calls, [
      { command: 'cancel_video_download', args: { id: 'selected-video' } },
      { command: 'retry_video_download', args: { id: 'failed-video' } },
    ]);
  } finally { h.dispose(); }
});
