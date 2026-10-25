import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { fakeClock } from './fixtures/fake-clock.mjs';

function harness(fallback = false) {
  const clock = fakeClock(), sent = [], nativeEvents = new Map(), windowEvents = new Map(), sheets = [];
  const element = (id, classes = []) => ({ nodeType: 1, id, classList: classes, querySelectorAll: () => [] });
  const root = element('', ['ADBAR']);
  let observer;
  class Sheet {
    cssRules = []; disabled = false;
    insertRule(rule) { if (rule.startsWith('INVALID')) throw new Error('Invalid selector'); this.cssRules.push(rule); }
  }
  const document = { documentElement: root, adoptedStyleSheets: [], addEventListener() {},
    createElement() { const sheet = new Sheet(); sheets.push(sheet); return { sheet }; } };
  root.appendChild = () => {};
  const window = { chrome: { webview: { postMessage: text => sent.push(JSON.parse(text)), addEventListener: (name, fn) => nativeEvents.set(name, fn) } },
    frames: [], addEventListener: (name, fn) => windowEvents.set(name, fn) };
  class ConstructedSheet extends Sheet { constructor() { super(); if (fallback) throw new Error('Unavailable'); sheets.push(this); } }
  class Observer { constructor(callback) { this.callback = callback; observer = this; } observe() { this.active = true; } disconnect() { this.active = false; } }
  runInNewContext(readFileSync(new URL('../src-tauri/src/adblock.js', import.meta.url), 'utf8').replace('__AURAVIEW_ADBLOCK_TOKEN__', '"secret"'), {
    window, document, location: { protocol: 'https:', href: 'https://example.com/' }, CSSStyleSheet: ConstructedSheet,
    MutationObserver: Observer, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  const reply = data => nativeEvents.get('message')({data:{kind:'auraview-adblock-rules',token:'secret',url:'https://example.com/',enabled:true,selectors:['.ADBAR'],...data}});
  return { clock, sent, sheets, observer, element, reply, refresh: () => nativeEvents.get('message')({data:{kind:'auraview-adblock-refresh'}}) };
}

test('cosmetic replies are bound to their native token and current document, with invalid selectors isolated', () => {
  const h = harness(); h.clock.advance(100);
  assert.equal(h.sent[0].classes[0], 'ADBAR');
  h.reply({token:'wrong'}); h.reply({url:'https://other.example/'});
  assert.equal(h.sheets.length, 0);
  h.reply({selectors:['INVALID[','.ADBAR']});
  assert.equal(h.sheets[0].cssRules.length, 1);
  h.reply({selectors:['.ADBAR']});
  assert.equal(h.sheets[0].cssRules.length, 1);
});

test('dynamic classes are deduplicated and sent in bounded batches', () => {
  const h = harness(); h.clock.advance(100);
  const node = h.element('new-ad', Array.from({length:300}, (_,i) => `ad-${i}`));
  h.observer.callback([{type:'attributes',target:node}]); h.clock.advance(300);
  const messages = h.sent.slice(1);
  assert.equal(messages.length, 3);
  assert.ok(messages.every(m => m.classes.length <= 128 && m.ids.length <= 128));
  assert.equal(messages.flatMap(m => m.classes).length, 300);
  h.observer.callback([{type:'attributes',target:node}]); h.clock.advance(100);
  assert.equal(h.sent.at(-1).classes.length, 0);
});

test('disabling during a pending scan can be re-enabled, including the fallback stylesheet', () => {
  for (const fallback of [false,true]) {
    const h = harness(fallback);
    h.reply({enabled:false}); // A reply can race with an already scheduled scan.
    h.clock.advance(100); assert.equal(h.sent.length, 0);
    assert.equal(h.observer.active, false);
    h.refresh(); h.clock.advance(100);
    assert.equal(h.sent.length, 1);
    h.reply({}); assert.equal(h.sheets[0].disabled, false);
    h.reply({enabled:false}); assert.equal(h.sheets[0].disabled, true);
    h.refresh(); h.clock.advance(100); h.reply({});
    assert.equal(h.sheets[0].disabled, false);
    assert.equal(h.sheets.length, 1);
  }
});
