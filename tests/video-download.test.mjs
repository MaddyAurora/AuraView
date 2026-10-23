import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src-tauri/src/video-download.js', import.meta.url), 'utf8')
  .replace('__AURAVIEW_VIDEO_TOKEN__', '"private-video-token"')
  .replace('__AURAVIEW_MEDIA_STREAMS__', readFileSync(new URL('../src-tauri/src/video-streams.js', import.meta.url), 'utf8'));

function page(href = 'https://example.com/feed') {
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
    contains(node) { return this === node || this.children.some((c) => c.contains(node)); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector === '#movie_player' ? node.attrs.id === 'movie_player' : selector === '.ad-showing' && node.attrs.class === 'ad-showing') return node; }
    getBoundingClientRect() { return { ...this.bounds, width: this.bounds.right - this.bounds.left, height: this.bounds.bottom - this.bounds.top }; }
    matches(selector) { return selector.split(',').some((s) => s === this.tagName.toLowerCase() || s === '*' || (s === ':popover-open' && this.open) ||
      (s === 'a[href]' && this.tagName === 'A' && this.href) || (s === '[role="dialog"]' && this.attrs.role === 'dialog') || (s === '[aria-modal="true"]' && this.attrs['aria-modal'] === 'true')); }
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
    crypto: { randomUUID: () => `request-${++serial}` },
    getComputedStyle: (node) => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', backgroundColor: 'rgba(0,0,0,0)', ...node.style }),
    requestAnimationFrame: (fn) => { frames.set(++frame, fn); return frame; }, cancelAnimationFrame: (id) => frames.delete(id),
  });
  const button = created.find((e) => e.tagName === 'BUTTON'), host = created.find((e) => e.tagName === 'AURAVIEW-VIDEO-TOOLS');
  const h = { window, document, location, messages, button, host, Element, Video,
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
  h.hover(new h.Element('p')); assert.equal(h.button.style.display, 'none');
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
test('recycled feed players do not carry progress or completion into their next video', () => {
  const h = page(), v = h.video(); h.hover(v); h.click();
  v.src = v.currentSrc = 'https://cdn.example.com/second.mp4'; h.hover(v);
  assert.equal(h.button.title, 'Download video'); h.result('request-1', 'saved');
  assert.equal(h.button.title, 'Download video'); h.click(); assert.equal(h.messages[1].url, v.currentSrc);
});
test('transparent covers work and opaque dialogs above a video do not', () => {
  const h = page(), box = h.add(new h.Element()), v = h.video(undefined, box), cover = h.add(new h.Element('a'), box);
  h.hover(cover); assert.equal(h.button.style.display, 'block'); h.click(); assert.equal(h.messages[0].url, v.src);
  cover.setAttribute('role', 'dialog'); h.hover(cover); assert.equal(h.button.style.display, 'none');
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
