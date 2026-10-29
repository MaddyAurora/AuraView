import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { fakeClock } from './fixtures/fake-clock.mjs';

const source = readFileSync(new URL('../src-tauri/src/video-download.js', import.meta.url), 'utf8')
  .replace('__AURAVIEW_VIDEO_TOKEN__', '"private-video-token"')
  .replace('__AURAVIEW_MEDIA_STREAMS__', readFileSync(new URL('../src-tauri/src/video-streams.js', import.meta.url), 'utf8'));

function page(href = 'https://example.com/feed') {
  const clock = fakeClock();
  const messages = [], created = [], frames = new Map(), observers = [];
  let hit, serial = 0, frame = 0;
  const events = (target) => {
    const handlers = new Map();
    target.addEventListener = (name, handler) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); };
    target.fire = (name, event = {}) => {
      event.preventDefault ||= () => { event.prevented = true; };
      event.stopImmediatePropagation ||= () => { event.stopped = true; };
      event.composedPath ||= () => [event.target];
      for (const handler of handlers.get(name) || []) handler(event);
      return event;
    };
    return target;
  };
  class Element {
    constructor(tag = 'div', bounds = { left: 100, top: 100, right: 500, bottom: 325 }) {
      this.tagName = tag.toUpperCase(); this.bounds = bounds; this.children = []; this.isConnected = true; this.style = {}; this.attrs = {}; events(this);
      Object.defineProperty(this, 'innerHTML', { set() { throw new TypeError('This document requires TrustedHTML assignment'); } });
      Object.defineProperty(this.style, 'cssText', { set(text) { for (const part of text.split(';')) { const i = part.indexOf(':'); if (i < 0) continue;
        this[part.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = part.slice(i + 1).replace('!important', '').trim(); } } });
    }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    focus() { this.focusVisible = true; this.fire('focus'); }
    contains(node) { return this === node || this.children.some((c) => c.contains(node)); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector === '#movie_player' ? node.attrs.id === 'movie_player' : selector === '.ad-showing' && node.attrs.class === 'ad-showing') return node; }
    getBoundingClientRect() { return { ...this.bounds, width: this.bounds.right - this.bounds.left, height: this.bounds.bottom - this.bounds.top }; }
    matches(selector) { return selector.split(',').some((s) => s === this.tagName.toLowerCase() || s === '*' || (s === ':popover-open' && this.open) ||
      (s === ':focus-visible' && this.focusVisible) || (s === 'a[href]' && this.tagName === 'A' && this.href) || (s === '[role="dialog"]' && this.attrs.role === 'dialog') || (s === '[aria-modal="true"]' && this.attrs['aria-modal'] === 'true')); }
    querySelectorAll(selector) { return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    attachShadow() { this.shadow = new Element('shadow'); this.shadow.host = this; return this.shadow; }
    getRootNode() { return this.host ? this : document; }
    showPopover() { this.open = true; this.lifts = (this.lifts || 0) + 1; }
    hidePopover() { this.open = false; }
  }
  class Video extends Element {
    constructor(url = 'https://cdn.example.com/video.mp4') { super('video'); this.src = this.currentSrc = url; this.readyState = 2; this.videoWidth = 480; this.duration = 4; this.paused = true; }
  }
  const html = new Element('html'), body = new Element('body'); html.append(body);
  const document = events({ documentElement: html, body, hidden: false, title: 'Sample video',
    querySelectorAll: (s) => html.querySelectorAll(s), elementsFromPoint: () => hit ? [hit] : [],
    createElement: (tag) => { const element = new Element(tag); created.push(element); return element; },
    createElementNS: (_, tag) => new Element(tag),
  });
  const window = events({ chrome: { webview: { postMessage: (payload) => messages.push(JSON.parse(payload)) } }, frames: [] }); window.parent = window;
  const location = new URL(href);
  class MutationObserver { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} }
  vm.runInNewContext(source, { window, document, location, URL, Element, HTMLVideoElement: Video, MutationObserver,
    innerWidth: 900, innerHeight: 700,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    crypto: { randomUUID: () => `request-${++serial}` },
    getComputedStyle: (node) => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', backgroundColor: 'rgba(0,0,0,0)', ...node.style }),
    requestAnimationFrame: (fn) => { frames.set(++frame, fn); return frame; }, cancelAnimationFrame: (id) => frames.delete(id),
  });
  const button = created.find((e) => e.tagName === 'BUTTON'), host = created.find((e) => e.tagName === 'AURAVIEW-VIDEO-TOOLS');
  const badge = created.find((e) => e.tagName === 'SPAN');
  const menu = created.find((e) => e.attrs.role === 'menu');
  const h = { window, document, location, messages, button, badge, host, menu, Element, Video, clock,
    advance(ms) { clock.advance(ms); h.flush(); },
    flush() { for (const [id, fn] of frames) { frames.delete(id); fn(); } },
    add(node, container = body) { container.append(node); observers[0].callback([{ target: container, addedNodes: [node] }]); h.flush(); return node; },
    video(url, container) { return h.add(new Video(url), container); },
    hover(node, x = 300, y = 180) { hit = node; window.fire('pointermove', { isTrusted: true, pointerType: 'mouse', clientX: x, clientY: y, composedPath: () => [node] }); h.flush(); },
    recheck() { observers[0].callback([{ target: body, addedNodes: [] }]); h.flush(); },
    click(trusted = true) { const e = button.fire('click', { isTrusted: trusted }); h.flush(); return e; },
    result(id, status, extra = {}) { window.fire('auraview-video-result', { detail: { id, status, message: status, ...extra } }); h.flush(); },
    link(url, container) { const link = new Element('a'); link.href = url; h.add(link, container); return link; },
  };
  return h;
}

test('the top-right button targets a paused video and trusted clicks only', () => {
  const h = page(), v = h.video(); h.hover(v);
  assert.equal(h.button.style.left, '462px'); assert.equal(h.button.style.top, '106px');
  assert.equal(h.button.style.display, 'block'); assert.equal(h.messages.length, 0);
  h.click(false); assert.equal(h.messages.length, 0);
  const event = h.click(); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(h.messages[0].url, v.currentSrc); assert.equal(h.messages[0].token, 'private-video-token');
  h.hover(new h.Element('p')); assert.equal(h.button.style.display, 'block');
});

test('available resolutions open a persistent dropdown and selecting one sends the exact choice once', () => {
  const h = page('https://www.youtube.com/watch?v=selected'), v = h.video();
  h.hover(v); h.click();
  assert.equal(h.menu.style.display, 'none', 'no menu until multiple resolutions are known');
  h.advance(4000);
  h.result('request-1', 'preparing', { resolutions: [2160, 1080, 720, 360] });
  assert.equal(h.menu.style.display, 'block');
  const options = h.menu.querySelectorAll('button');
  assert.deepEqual(options.map((b) => b.textContent), ['2160p · Best quality', '1080p', '720p', '360p']);
  h.advance(10000); h.hover(h.host, 440, 220); h.recheck();
  assert.equal(h.menu.style.display, 'block', 'idle and host hit tests must keep the choices usable');
  options[2].fire('click', { isTrusted: false });
  assert.equal(h.messages.length, 1);
  options[2].fire('click', { isTrusted: true });
  assert.equal(h.menu.style.display, 'none');
  assert.deepEqual(h.messages[1], { kind: 'auraview-video-select', id: 'request-1', resolution: 720, token: 'private-video-token' });
  options[2].fire('click', { isTrusted: true });
  assert.equal(h.messages.length, 2, 'a detached menu item cannot submit twice');
  h.result('request-1', 'downloading', { percent: 20 });
  h.click(); assert.equal(h.messages.at(-1).kind, 'auraview-video-cancel');
});

test('resolution menus cancel on Escape, navigation, and recycled players', () => {
  for (const dismiss of ['escape', 'navigation', 'recycle']) {
    const h = page(), v = h.video(); h.hover(v); h.click();
    h.result('request-1', 'preparing', { resolutions: [1080, 720] });
    const stale = h.menu.querySelectorAll('button')[0];
    if (dismiss === 'escape') h.window.fire('keydown', { key: 'Escape', isTrusted: true });
    if (dismiss === 'navigation') h.window.fire('pagehide');
    if (dismiss === 'recycle') { v.currentSrc = v.src = 'https://cdn.example.com/next.mp4'; h.recheck(); }
    h.flush();
    assert.equal(h.menu.style.display, 'none', dismiss);
    assert.equal(h.messages.at(-1).kind, 'auraview-video-cancel', dismiss);
    stale.fire('click', { isTrusted: true });
    assert.equal(h.messages.length, 2, 'dismissed choices cannot start a download');
  }
});

test('MP3 is below video resolutions and uses an audio-only selection', () => {
  for (const [mode, label] of [['download', 'Download MP3'], ['convert', 'Convert to MP3']]) {
    const h = page('https://www.youtube.com/watch?v=selected'), v = h.video(); h.hover(v); h.click();
    h.result('request-1', 'preparing', { resolutions: [1080, 720], audioOption: mode });
    const options = h.menu.querySelectorAll('button');
    assert.deepEqual(options.map((b) => b.textContent), ['1080p · Best quality', '720p', label]);
    options[2].fire('click', { isTrusted: false }); assert.equal(h.messages.length, 1);
    options[2].fire('click', { isTrusted: true });
    assert.deepEqual(h.messages[1], { kind: 'auraview-video-select', id: 'request-1', audioOnly: true, token: 'private-video-token' });
    assert.equal(h.menu.style.display, 'none');
    options[2].fire('click', { isTrusted: true }); assert.equal(h.messages.length, 2);
    h.result('request-1', 'preparing', { audioOption: null });
    assert.equal(h.menu.style.display, 'none', 'preparation must not reopen the menu');
    h.result('request-1', 'merging', { message: 'Converting to MP3…' });
    assert.equal(h.badge.textContent, 'Converting…');
    h.click(); assert.equal(h.messages.at(-1).kind, 'auraview-video-cancel');
  }
});

test('single-resolution and direct videos still offer MP3 without losing the video choice', () => {
  for (const resolutions of [[720], []]) {
    const h = page(), v = h.video(); h.hover(v); h.click();
    h.result('request-1', 'preparing', { resolutions, audioOption: 'convert' });
    assert.equal(h.menu.style.display, 'block');
    const options = h.menu.querySelectorAll('button');
    assert.deepEqual(options.map((b) => b.textContent), [resolutions.length ? '720p · Best quality' : 'Video · Best available', 'Convert to MP3']);
    options[0].fire('click', { isTrusted: true });
    assert.equal(h.messages[1].audioOnly, undefined);
    assert.equal(h.messages[1].resolution, resolutions[0]);
    h.result('request-1', 'preparing', { audioOption: null });
    assert.equal(h.menu.style.display, 'none');
  }
});

test('late MP3 menus cannot attach to recycled players and audio options remain cancelable', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  v.currentSrc = v.src = 'https://cdn.example.com/next.mp4'; h.recheck();
  h.result('request-1', 'preparing', { audioOption: 'convert' });
  assert.equal(h.menu.style.display, 'none');
  h.click(); h.result('request-2', 'preparing', { audioOption: 'download' });
  assert.equal(h.menu.style.display, 'block');
  h.window.fire('keydown', { key: 'Escape', isTrusted: true }); h.flush();
  assert.equal(h.messages.at(-1).id, 'request-2');
  assert.equal(h.messages.at(-1).kind, 'auraview-video-cancel');
});

test('resolution menus support keyboard navigation and stay within the viewport', () => {
  const h = page(), v = h.video(); v.bounds = { left: 10, right: 210, top: 580, bottom: 700 };
  h.hover(v, 100, 620); h.click(); h.result('request-1', 'preparing', { resolutions: [1080, 720, 480] });
  const options = h.menu.querySelectorAll('button');
  h.window.fire('keydown', { key: 'ArrowDown', isTrusted: true, composedPath: () => [h.button, h.host] });
  assert.equal(options[0].focusVisible, true);
  h.window.fire('keydown', { key: 'End', isTrusted: true, composedPath: () => [options[0], h.host] });
  assert.equal(options.at(-1).focusVisible, true);
  assert.ok(parseFloat(h.menu.style.top) + h.menu.getBoundingClientRect().height <= 700);
  assert.ok(parseFloat(h.menu.style.left) >= 6);
});

test('single-resolution downloads continue without a menu and late choices cannot target a different video', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  h.result('request-1', 'downloading'); assert.equal(h.menu.style.display, 'none');
  h.result('request-1', 'saved'); h.click();
  v.currentSrc = v.src = 'https://cdn.example.com/next.mp4'; h.recheck();
  h.result('request-2', 'preparing', { resolutions: [1080, 720] });
  assert.equal(h.menu.style.display, 'none');
  h.click(); assert.equal(h.messages.at(-1).kind, 'auraview-video-download');
});

test('video overlays hide after three idle seconds and only real pointer movement restarts the deadline', () => {
  const h = page(), v = h.video();
  h.hover(v); h.advance(2999); assert.equal(h.button.style.display, 'block');
  h.advance(1); assert.equal(h.button.style.display, 'none');
  h.hover(v); assert.equal(h.button.style.display, 'none', 'same-coordinate pointer events do not wake the overlay');
  h.hover(v, 301, 180); assert.equal(h.button.style.display, 'block');
  h.advance(2000); h.hover(v, 302, 180); h.advance(1000);
  assert.equal(h.button.style.display, 'block', 'moving restarts the full three-second interval');
  assert.equal(h.clock.pending, 1, 'pointer movements replace the old timer');
  h.advance(2000); assert.equal(h.button.style.display, 'none');
});

test('active download remains visible through pointer movement, idle, outside clicks, and focus changes', () => {
  const h = page(), v = h.video(), outside = new h.Element('p');
  h.hover(v); h.click();
  h.hover(outside, 700, 400); h.advance(4000);
  h.window.fire('pointerdown', { composedPath: () => [outside] });
  h.document.fire('focusin', { target: outside }); h.flush();
  assert.equal(h.button.style.display, 'block');
  h.result('request-1', 'preparing', { resolutions: [1080, 720] });
  assert.equal(h.menu.style.display, 'block');
  h.window.fire('pointerdown', { composedPath: () => [outside] });
  h.window.fire('blur'); h.flush(); h.advance(4000);
  assert.equal(h.menu.style.display, 'block');
  assert.equal(h.button.style.display, 'block');
  assert.equal(h.messages.length, 1);
  h.menu.querySelectorAll('button')[1].fire('click', { isTrusted: true }); h.flush();
  assert.equal(h.messages.at(-1).resolution, 720);
  h.result('request-1', 'downloading', { percent: 50 }); h.advance(4000);
  assert.equal(h.button.style.display, 'block'); assert.equal(h.badge.textContent, '50%');
  h.button.focusVisible = false; h.button.fire('blur'); h.flush();
  h.result('request-1', 'error');
  assert.equal(h.button.style.display, 'none', 'failed request returns to ordinary idle visibility');
  h.hover(v, 301, 180); assert.equal(h.button.style.color, '#fca5a5');
});

test('keyboard focus on the download action remains usable while ordinary mouse focus still times out', () => {
  const h = page(), v = h.video();
  h.hover(v); h.button.fire('focus'); h.advance(3000);
  assert.equal(h.button.style.display, 'none', 'mouse focus must not keep the fullscreen overlay visible');
  v.focusVisible = true;
  h.document.fire('focusin', { target: v }); h.flush();
  assert.equal(h.button.style.display, 'block', 'keyboard navigation can expose the download action');
  h.button.focusVisible = true; h.button.fire('focus'); h.advance(3000);
  assert.equal(h.button.style.display, 'block', 'retain the action while it has a keyboard focus ring');
  h.button.focusVisible = false; h.button.fire('blur'); h.flush();
  assert.equal(h.button.style.display, 'none');
  h.hover(v, 301, 180); h.window.fire('blur'); h.flush();
  assert.equal(h.clock.pending, 0); assert.equal(h.button.style.display, 'none');
});
test('in-flight clicks cancel rather than starting another download; failures can retry', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  h.result('request-1', 'downloading', { percent: 40 });
  assert.match(h.button.title, /cancel/); h.click();
  assert.equal(h.messages[1].kind, 'auraview-video-cancel'); assert.equal(h.messages[1].id, 'request-1');
  h.result('request-1', 'cancelled'); h.click(); assert.equal(h.messages[2].id, 'request-2');
  h.result('request-2', 'error'); assert.match(h.button.title, /retry/);
  h.click(); assert.equal(h.messages[3].id, 'request-3');
});
test('player mutations cannot hide the button while the pointer is on its closed shadow host', () => {
  const h = page(), v = h.video(); h.hover(v);
  for (let move = 0; move < 12; move++) {
    h.hover(h.host, 470 + move % 5, 115);
    h.recheck();
    assert.equal(h.button.style.display, 'block', `button vanished on movement ${move}`);
  }
  h.click(); assert.equal(h.messages[0].url, v.src);
});
test('opaque controls inside a player do not make its download button blink', () => {
  const h = page(), box = h.add(new h.Element()), v = h.video(undefined, box), controls = h.add(new h.Element(), box);
  h.hover(v);
  for (const background of ['rgb(0, 0, 0)', 'rgba(0,0,0,0)', 'rgb(30, 30, 30)']) {
    controls.style.backgroundColor = background; h.hover(controls);
    assert.equal(h.button.style.display, 'block');
  }
});
test('Instagram permalinks can live above deeply nested player markup', () => {
  const h = page('https://www.instagram.com/'), post = h.add(new h.Element('article'));
  let scope = post;
  for (let i = 0; i < 14; i++) scope = h.add(new h.Element(), scope);
  const v = h.video('blob:https://www.instagram.com/stream', scope);
  h.link('https://www.instagram.com/creator/reel/SELECTED/?utm_source=test', post);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/reel/SELECTED/');
});
test('Instagram home cards use the player wrapper link and ignore audio-page links', () => {
  const h = page('https://www.instagram.com/'), post = h.add(new h.Element('article'));
  h.link('https://www.instagram.com/p/SELECTED/', post);
  h.link('https://www.instagram.com/reels/audio/123456789/', post);
  const player = h.link('https://www.instagram.com/reels/SELECTED/', post);
  const v = h.video('blob:https://www.instagram.com/stream', player);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/reel/SELECTED/');
});
test('Instagram p and reel links for the same home post are not ambiguous', () => {
  const h = page('https://www.instagram.com/'), post = h.add(new h.Element('article'));
  const v = h.video('blob:https://www.instagram.com/stream', post);
  h.link('https://www.instagram.com/p/SELECTED/', post);
  h.link('https://www.instagram.com/reels/SELECTED/', post);
  h.link('https://www.instagram.com/reels/audio/123456789/', post);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/p/SELECTED/');
});
test('Instagram story videos resolve the selected numeric story ID', () => {
  const h = page('https://www.instagram.com/stories/distrokid/3994261805935619921/?utm_source=test');
  const v = h.video('blob:https://www.instagram.com/story');
  h.hover(v); h.click();
  assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/stories/distrokid/3994261805935619921/');
});

test('Instagram post players send their own player identity for carousel matching', () => {
  const h = page('https://www.instagram.com/p/SELECTED/'), v = h.video('blob:https://www.instagram.com/playing');
  v.__reactFiber$test = { memoizedProps: { coreVideoPlayerMetaData: { videoFBID: '123456', poster: 'https://scontent.cdninstagram.com/selected.jpg' } } };
  h.hover(v); h.click();
  assert.equal(h.messages[0].instagramVideoId, '123456');
  assert.equal(h.messages[0].poster, 'https://scontent.cdninstagram.com/selected.jpg');
});

test('Home streaming stories send only the owning player poster and recycled players reset their download identity', () => {
  const h = page('https://www.instagram.com/stories/creator/');
  const v = h.video('blob:https://www.instagram.com/playing');
  const metadata = { poster: { uri: 'https://scontent.cdninstagram.com/selected.jpg?signature=one' }, videoFBID: '3994261805935619921' };
  v.__reactFiber$test = { memoizedProps: {}, return: { memoizedProps: { coreVideoPlayerMetaData: metadata }, return: {
    memoizedProps: { coreVideoPlayerMetaData: { poster: 'https://scontent.cdninstagram.com/neighbor.jpg' } },
  } } };
  h.hover(v); h.click();
  assert.equal(h.messages[0].poster, metadata.poster.uri);
  assert.equal(h.messages[0].instagramVideoId, metadata.videoFBID);
  assert.equal(h.messages[0].pageUrl, '', 'account collection must not be passed to the permalink extractor');
  metadata.poster.uri = 'https://scontent.cdninstagram.com/next.jpg';
  h.recheck(); h.click();
  assert.equal(h.messages[1].kind, 'auraview-video-download', 'next story must not cancel the previous story job');
  assert.equal(h.messages[1].poster, metadata.poster.uri);
  metadata.poster = null;
  h.recheck(); h.click();
  assert.equal(h.messages[2].poster, '', 'missing current poster must not borrow metadata from a higher component');
});

test('Home account story routes never download an embedded reshared Reel as the story', () => {
  const h = page('https://www.instagram.com/stories/creator/'), box = h.add(new h.Element());
  const v = h.video('blob:https://www.instagram.com/playing', box);
  h.link('https://www.instagram.com/reel/reshared/', box);
  v.__reactFiber$test = { memoizedProps: { coreVideoPlayerMetaData: { videoFBID: '3994261805935619921' } } };
  h.hover(v); h.click();
  assert.equal(h.messages[0].pageUrl, '');
  assert.equal(h.messages[0].instagramVideoId, '3994261805935619921');
});

test('the current story takes precedence over a reshared Reel link and follows story navigation', () => {
  const h = page('https://www.instagram.com/stories/creator/3994261805935619921/'), box = h.add(new h.Element());
  const v = h.video('blob:https://www.instagram.com/story', box);
  h.link('https://www.instagram.com/reel/RESHARED/', box);
  h.hover(v); h.click();
  assert.equal(h.messages[0].pageUrl, h.location.href);
  h.result('request-1', 'saved');
  h.location.href = 'https://www.instagram.com/stories/creator/3994261805935619922/';
  h.recheck();
  assert.equal(h.button.title, 'Download video');
  h.click(); assert.equal(h.messages[1].pageUrl, h.location.href);
  assert.equal(h.messages[1].kind, 'auraview-video-download');
});

test('preloaded neighboring story players cannot inherit the active story route', () => {
  const h = page('https://www.instagram.com/stories/creator/3994261805935619921/');
  const viewer = h.add(new h.Element()), v = h.video('blob:https://www.instagram.com/current', viewer);
  const next = h.video('blob:https://www.instagram.com/next', viewer);
  next.bounds = { left: 600, right: 750, top: 100, bottom: 250 };
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, h.location.href);
  h.hover(next, 650, 180); h.click(); assert.equal(h.messages[1].pageUrl, '');
});

test('story links are identified by story ID rather than the account name', () => {
  const h = page('https://www.instagram.com/'), box = h.add(new h.Element());
  const v = h.video('blob:https://www.instagram.com/story', box);
  h.link('https://www.instagram.com/stories/creator/3994261805935619921/', box);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/stories/creator/3994261805935619921/');
  h.result('request-1', 'saved');
  h.link('https://www.instagram.com/stories/creator/3994261805935619922/', box);
  h.hover(v); h.click(); assert.equal(h.messages[1].pageUrl, '', 'different stories by the same account are ambiguous');
});

test('account story collections and highlights never identify one selected story video', () => {
  for (const path of ['stories/creator/', 'stories/highlights/18090946048123978/', 'stories/creator/not-a-number/']) {
    const h = page(`https://www.instagram.com/${path}`), v = h.video('blob:https://www.instagram.com/story');
    h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, '');
  }
});

test('recycled feed players do not carry progress or completion into their next video', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  v.src = v.currentSrc = 'https://cdn.example.com/second.mp4'; h.hover(v);
  assert.equal(h.button.title, 'Download video'); h.result('request-1', 'saved');
  assert.equal(h.button.title, 'Download video'); h.click(); assert.equal(h.messages[1].url, v.currentSrc);
});
test('transparent covers work and opaque dialogs above a video do not', () => {
  const h = page(), box = h.add(new h.Element()), v = h.video(undefined, box), cover = h.add(new h.Element('a'), box);
  h.hover(cover); assert.equal(h.button.style.display, 'block'); h.click(); assert.equal(h.messages[0].url, v.src);
  h.result('request-1', 'error'); cover.setAttribute('role', 'dialog'); h.hover(cover); assert.equal(h.button.style.display, 'none');
});
test('the button follows clipping and hides on unloaded, invisible, or tiny players', () => {
  const h = page(), box = h.add(new h.Element()), v = h.video(undefined, box);
  box.style.overflowY = 'hidden'; box.bounds.top = 150; h.hover(v, 300, 180); assert.equal(h.button.style.top, '156px');
  v.style.display = 'none'; h.hover(v); assert.equal(h.button.style.display, 'none');
  v.style.display = 'block'; v.readyState = 0; h.hover(v); assert.equal(h.button.style.display, 'none');
  v.readyState = 2; v.bounds.right = 120; h.hover(v, 110); assert.equal(h.button.style.display, 'none');
});
test('Instagram feed links are resolved within the selected post', () => {
  const h = page('https://www.instagram.com/'), first = h.add(new h.Element('article')), second = h.add(new h.Element('article'));
  const a = h.video('blob:https://www.instagram.com/first', first), b = h.video('blob:https://www.instagram.com/second', second);
  h.link('https://www.instagram.com/reel/FIRST/', first); h.link('https://www.instagram.com/p/SECOND/', second);
  h.hover(b); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.instagram.com/p/SECOND/'); assert.equal(h.messages[0].url, b.src);
  h.hover(a); h.click(); assert.equal(h.messages[1].pageUrl, 'https://www.instagram.com/reel/FIRST/');
});
test('ambiguous multi-video feeds never fall back to the entire page', () => {
  const h = page('https://www.instagram.com/'), a = h.video('blob:https://www.instagram.com/a'); h.video('blob:https://www.instagram.com/b');
  h.hover(a); h.click(); assert.equal(h.messages[0].pageUrl, '');
});
test('YouTube watch and Shorts URLs resolve only the current video, without a playlist', () => {
  for (const url of ['https://www.youtube.com/watch?v=selected&list=mix', 'https://www.youtube.com/shorts/selected']) {
    const h = page(url), v = h.video('blob:https://www.youtube.com/stream'); h.hover(v); h.click();
    assert.equal(h.messages[0].pageUrl, 'https://www.youtube.com/watch?v=selected');
  }
});

test('watch pages keep the main streaming video identifiable after an advertisement leaves another player behind', () => {
  for (const url of ['https://www.pornhub.com/view_video.php?viewkey=6aac4f929c636',
    'https://www.xvideos.com/video.ucufvldcccf/example_title']) {
    const h = page(url), box = h.add(new h.Element());
    const main = h.video('https://cdn.example/advertisement.mp4', box);
    const other = h.video('https://cdn.example/other-player.mp4');
    other.bounds = { left: 600, right: 750, top: 100, bottom: 180 };
    h.hover(main); h.click();
    assert.equal(h.messages[0].url, 'https://cdn.example/advertisement.mp4', 'direct ad download remains available');
    h.result('request-1', 'saved');
    main.currentSrc = main.src = `blob:${new URL(url).origin}/main-video`;
    h.recheck(); h.hover(main); h.click();
    assert.equal(h.messages[1].pageUrl, url);
    assert.equal(h.messages[1].streamOnly, false);
    h.hover(other, 650, 140); h.click();
    assert.equal(h.messages[2].pageUrl, '', 'secondary players must not inherit the main watch URL');
  }
});

test('recognized watch routes override recommendations inside the main player but preserve only the selected ID', () => {
  const cases = [
    ['https://www.pornhub.com/view_video.php?viewkey=selected123&tracking=test#player',
      'https://www.pornhub.com/view_video.php?viewkey=selected123', 'https://www.pornhub.com/view_video.php?viewkey=neighbor456'],
    ['https://www.xvideos.com/video.abc123/example_title?tracking=test#player',
      'https://www.xvideos.com/video.abc123/example_title', 'https://www.xvideos.com/video.def456/neighbor'],
  ];
  for (const [url, expected, recommendation] of cases) {
    const h = page(url), box = h.add(new h.Element());
    const v = h.video(`blob:${new URL(url).origin}/main`, box);
    h.link(recommendation, box);
    h.hover(v); h.click();
    assert.equal(h.messages[0].pageUrl, expected);
  }
});

test('a retained ad directly underneath the main watch player cannot hide its watch-page identity', () => {
  for (const url of ['https://www.pornhub.com/view_video.php?viewkey=selected123',
    'https://www.xvideos.com/video.abc123/example_title']) {
    const h = page(url);
    const oldAd = h.video('https://cdn.example/advertisement.mp4');
    const main = h.video(`blob:${new URL(url).origin}/main`);
    h.document.elementsFromPoint = () => [main, oldAd];
    h.hover(main); h.click();
    assert.equal(h.messages[0].pageUrl, url);
    h.result('request-1', 'saved');
    h.hover(h.host, 470, 115); h.recheck(); h.click();
    assert.equal(h.messages[1].pageUrl, url, 'moving onto the download button retains the selected player');
    h.result('request-2', 'saved');
    h.document.elementsFromPoint = () => [oldAd, main];
    h.hover(main); h.click();
    assert.equal(h.messages[2].pageUrl, '', 'a covered player cannot claim the main route');
  }
});

test('watch recognition leaves ambiguous players, listings, and lookalike domains unidentified', () => {
  for (const url of ['https://www.pornhub.com/view_video.php?viewkey=selected123',
    'https://www.xvideos.com/video.abc123/example_title', 'https://www.pornhub.com/',
    'https://www.xvideos.com/', 'https://pornhub.com.evil.example/view_video.php?viewkey=selected123',
    'https://notxvideos.com/video.abc123/example_title']) {
    const h = page(url), a = h.video(`blob:${new URL(url).origin}/a`);
    const b = h.video(`blob:${new URL(url).origin}/b`);
    b.bounds = { left: 500, right: 900, top: 100, bottom: 325 };
    h.hover(a); h.click();
    assert.equal(h.messages[0].pageUrl, '');
  }
});

test('watch URL aliases preserve the exact media ID while rejecting malformed IDs', () => {
  for (const [url, expected] of [
    ['https://www.pornhub.com/embed/abc123/', 'https://www.pornhub.com/view_video.php?viewkey=abc123'],
    ['https://www.pornhub.com/video/show?viewkey=abc123&ref=test', 'https://www.pornhub.com/view_video.php?viewkey=abc123'],
    ['https://www.xvideos.com/video12345/example_title?ref=test', 'https://www.xvideos.com/video12345/example_title'],
    ['https://www.pornhub.com/view_video.php?viewkey=one&viewkey=two', ''],
    ['https://www.pornhub.com/view_video.php?viewkey=bad%2Fid', ''],
    ['https://www.xvideos.com/videos/abc123', ''],
  ]) {
    const h = page(url), main = h.video(`blob:${new URL(url).origin}/main`);
    const other = h.video('https://cdn.example/other.mp4');
    other.bounds = { left: 600, right: 750, top: 100, bottom: 180 };
    h.hover(main); h.click();
    assert.equal(h.messages[0].pageUrl, expected);
  }
});
test('YouTube end-screen links do not change the main download, and ads never inherit its watch URL', () => {
  const h = page('https://www.youtube.com/watch?v=selected'), box = h.add(new h.Element()); box.setAttribute('id', 'movie_player');
  const v = h.video('blob:https://www.youtube.com/stream', box); h.link('https://www.youtube.com/watch?v=next-video', box);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.youtube.com/watch?v=selected');
  h.result('request-1', 'saved'); box.setAttribute('class', 'ad-showing'); h.hover(v); h.click();
  assert.equal(h.messages.length, 2); assert.equal(h.messages[1].pageUrl, ''); assert.equal(h.messages[1].streamOnly, true);
});
test('X home-feed videos use their own status link instead of the home timeline', () => {
  const h = page('https://x.com/home'), first = h.add(new h.Element('article')), second = h.add(new h.Element('article'));
  const a = h.video('blob:https://x.com/first', first), b = h.video('blob:https://x.com/second', second);
  h.link('https://x.com/example/status/1234567890', first); h.link('https://x.com/another/status/9988776655', second);
  h.hover(b); h.click(); assert.equal(h.messages[0].pageUrl, 'https://x.com/i/status/9988776655');
  h.hover(a); h.click(); assert.equal(h.messages[1].pageUrl, 'https://x.com/i/status/1234567890');
});
test('Twitter aliases and selected multi-video indexes retain the exact status identity', () => {
  const h = page('https://twitter.com/home'), post = h.add(new h.Element('article'));
  const wrapper = h.link('https://twitter.com/example/status/1234567890/video/2?ref=feed', post);
  const v = h.video('blob:https://twitter.com/selected', wrapper); h.hover(v); h.click();
  assert.equal(h.messages[0].pageUrl, 'https://x.com/i/status/1234567890/video/2');
});
test('a missing X post link does not send /home to the extractor or borrow a neighboring tweet', () => {
  const h = page('https://x.com/home'), post = h.add(new h.Element('article')), next = h.add(new h.Element('article'));
  const v = h.video('blob:https://x.com/selected', post); h.link('https://x.com/other/status/9988776655', next);
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, '');
});
test('a Shorts player can identify the current route while an adjacent player is partly visible', () => {
  const h = page('https://www.youtube.com/shorts/selected'), v = h.video('blob:https://www.youtube.com/selected');
  const next = h.video('blob:https://www.youtube.com/next'); next.bounds = { left: 100, right: 500, top: 630, bottom: 850 };
  h.hover(v); h.click(); assert.equal(h.messages[0].pageUrl, 'https://www.youtube.com/watch?v=selected');
  h.hover(next, 300, 650); h.click(); assert.equal(h.messages.length, 1, 'the adjacent player must not inherit the current route');
});
test('DRM and live playback explain why downloading is unavailable', () => {
  const h = page(), v = h.video(); h.hover(v); v.mediaKeys = {}; h.hover(v); h.click();
  assert.equal(h.messages.length, 0); assert.match(h.button.title, /Protected/);
  v.mediaKeys = undefined; v.duration = Infinity; h.hover(v); h.click(); assert.equal(h.messages.length, 0); assert.match(h.button.title, /Live/);
});
test('keyboard focus exposes the button and fullscreen lifts it above the player', () => {
  const h = page(), v = h.video();
  h.document.fire('focusin', { target: v }); h.flush(); assert.equal(h.button.style.display, 'block');
  const before = h.host.lifts; h.document.fire('fullscreenchange'); h.flush(); assert.ok(h.host.lifts > before);
  h.window.fire('blur'); h.flush(); assert.equal(h.button.style.display, 'none');
});
test('frame results are forwarded and unrelated window messages cannot complete a job', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  const received = []; h.window.frames.push({ postMessage: (data) => received.push(data) });
  h.window.fire('message', { source: {}, data: { kind: 'auraview-video-result', id: 'request-1', status: 'saved' } }); h.flush();
  assert.match(h.button.title, /cancel/);
  h.result('request-1', 'saved', { message: 'Saved to Downloads' }); assert.equal(h.button.title, 'Saved to Downloads'); assert.equal(received.length, 1);
});
