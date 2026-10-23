import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src-tauri/src/image-download.js', import.meta.url), 'utf8')
  .replace('__AURAVIEW_IMAGE_TOKEN__', '"test-bridge-token"');

function page({ observe = false } = {}) {
  const documentEvents = new Map(), windowEvents = new Map(), frames = new Map(), messages = [], created = [];
  let nextFrame = 0, nextRequest = 0, hit = null, fetches = 0;
  let fetchResult = async () => { throw new Error('No response configured'); };
  function eventTarget(target, events) {
    target.addEventListener = (name, handler) => {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    };
    target.fire = (name, event = {}) => {
      event.preventDefault ||= () => { event.defaultPrevented = true; };
      event.stopImmediatePropagation ||= () => { event.stopped = true; };
      for (const handler of events.get(name) || []) handler(event);
      return event;
    };
    return target;
  }
  function style() {
    const values = {};
    Object.defineProperty(values, 'cssText', { set(text) {
      for (const declaration of text.split(';')) {
        const [name, value] = declaration.split(':');
        if (name && value) values[name.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value.replace('!important', '').trim();
      }
    } });
    return values;
  }
  class Element {
    constructor(tag = 'div', bounds = { left: 100, top: 80, right: 400, bottom: 280 }) {
      this.tagName = tag.toUpperCase(); this.bounds = bounds; this.style = style(); this.children = [];
      this.attributes = {}; this.isConnected = true; eventTarget(this, new Map());
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    querySelectorAll() { return this.children.flatMap((child) => [...(child instanceof Image ? [child] : []), ...child.querySelectorAll()]); }
    append(child) { this.children.push(child); child.parentElement = this; }
    attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
    getBoundingClientRect() { return { ...this.bounds, width: this.bounds.right - this.bounds.left, height: this.bounds.bottom - this.bounds.top }; }
  }
  class Image extends Element {
    constructor(url = 'https://images.example.com/photo.png') {
      super('img'); this.complete = true; this.naturalWidth = 800; this.src = url; this.currentSrc = url;
    }
  }
  const root = new Element('html'), body = new Element('body'); root.append(body);
  const document = eventTarget({ documentElement: root, body, hidden: false,
    createElement(tag) { const element = new Element(tag); created.push(element); return element; },
    createElementNS(_, tag) { return new Element(tag); }, elementFromPoint: () => hit,
    elementsFromPoint: () => hit ? [hit] : [],
  }, documentEvents);
  Object.defineProperty(document, 'images', { get() {
    const images = new Set();
    const visit = (element) => { if (element instanceof Image) images.add(element); for (const child of element.children) visit(child); };
    visit(root); return [...images];
  } });
  document.querySelectorAll = () => document.images;
  const tracked = new Set();
  let intersection, mutation;
  class IntersectionObserver {
    constructor(callback) { intersection = callback; }
    observe(image) { tracked.add(image); }
    unobserve(image) { tracked.delete(image); }
  }
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe() {}
  }
  const window = eventTarget({ innerWidth: 800, innerHeight: 600, frames: [],
    chrome: { webview: { postMessage: (message) => messages.push(JSON.parse(message)) } },
  }, windowEvents);
  window.parent = window;
  class FileReader {
    readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${blob.data}`;
      Promise.resolve().then(() => this.onload());
    }
  }
  vm.runInNewContext(source, { window, document, Element, HTMLImageElement: Image, FileReader,
    ...(observe ? { IntersectionObserver, MutationObserver } : {}),
    crypto: { randomUUID: () => `request-${++nextRequest}` },
    getComputedStyle: (element) => ({ overflowX: 'visible', overflowY: 'visible', backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)', display: 'block', visibility: 'visible', opacity: '1', ...element.style }),
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    fetch: (...args) => { fetches++; return fetchResult(...args); },
  });
  const button = created.find((element) => element.tagName === 'BUTTON');
  const h = {
    window, document, button, messages, Element, Image,
    get fetches() { return fetches; },
    tracked,
    mutate(records) { mutation(records); },
    intersect(image, isIntersecting = true) { intersection([{ target: image, isIntersecting }]); h.flush(); },
    image(url) { const image = new Image(url); body.append(image); return image; },
    flush() { for (const [id, callback] of frames) { frames.delete(id); callback(); } },
    hover(element, x = 385, y = 265) {
      hit = element;
      window.fire('pointermove', { isTrusted: true, pointerType: 'mouse', clientX: x, clientY: y,
        composedPath: () => [element] }); h.flush();
    },
    click(trusted = true) { const event = button.fire('click', { isTrusted: trusted }); h.flush(); return event; },
    result(id, status, extra = {}) {
      window.fire('auraview-image-result', { detail: { id, status, ...extra } }); h.flush();
    },
    response(response) { fetchResult = async () => response; },
    async settled() { await new Promise((resolve) => setImmediate(resolve)); h.flush(); },
    scrollTo(element) { hit = element; document.fire('scroll'); h.flush(); },
  };
  return h;
}

test('the hover button stays in the image corner and disappears on non-images, blur, and page exit', () => {
  const h = page(), image = h.image();
  assert.equal(h.button.style.display, 'none');
  h.hover(image);
  assert.equal(h.button.style.display, 'grid');
  assert.equal(h.button.style.left, '368px'); assert.equal(h.button.style.top, '248px');
  assert.equal(h.messages.length, 0, 'hovering alone must never download');
  h.hover(new h.Element('p')); assert.equal(h.button.style.display, 'none');
  h.hover(image); h.window.fire('blur'); h.flush(); assert.equal(h.button.style.display, 'none');
  h.hover(image); h.window.fire('pagehide'); assert.equal(h.button.style.display, 'none');
  h.window.fire('pageshow'); h.hover(image); assert.equal(h.button.style.display, 'grid');
});

test('trusted clicks download currentSrc without following image links and suppress duplicate in-flight clicks', () => {
  const h = page(), image = h.image('https://cdn.example.com/large.avif');
  image.src = 'https://cdn.example.com/small.jpg';
  h.hover(image); h.click(false); assert.equal(h.messages.length, 0);
  const click = h.click();
  assert.equal(click.defaultPrevented, true); assert.equal(click.stopped, true);
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].url, image.currentSrc);
  assert.equal(h.fetches, 0, 'HTTP images should first use original cached bytes');
  h.click(); assert.equal(h.messages.length, 1);
  h.result(h.messages[0].id, 'saved', { filename: 'large.avif' });
  assert.equal(h.button.title, 'Saved large.avif to Downloads');
  h.click(); assert.equal(h.messages.length, 2, 'an intentional second download remains possible');
});

test('transparent gallery covers reveal the underlying image and preserve signed responsive URLs', () => {
  const h = page(), gallery = new h.Element(), cover = new h.Element(), inner = new h.Element('span');
  const image = h.image('https://cdn.example.com/photo.jpg?signature=a%2Fb&expires=123');
  image.src = 'https://cdn.example.com/preview.jpg'; image.style.pointerEvents = 'none';
  h.document.body.append(gallery); gallery.append(image); gallery.append(cover); cover.append(inner);
  h.hover(inner); assert.equal(h.button.style.display, 'grid');
  assert.equal(h.button.style.left, '368px'); assert.equal(h.button.style.top, '248px');
  h.click(); assert.equal(h.messages.at(-1).url, image.currentSrc);
  assert.equal(h.fetches, 0, 'covered images still use the native session/cache download path');
  h.hover(h.document.body); assert.equal(h.button.style.display, 'none');
});

test('carousel covers target only the visible, loaded slide and follow source changes', () => {
  const h = page(), gallery = new h.Element(), cover = new h.Element();
  gallery.style.overflowX = 'hidden'; gallery.style.overflowY = 'hidden';
  h.document.body.append(gallery);
  const shown = h.image('https://cdn.example.com/first.webp'); gallery.append(shown);
  const hidden = h.image('https://cdn.example.com/hidden.webp'); hidden.style.opacity = '0'; gallery.append(hidden);
  const offscreen = h.image('https://cdn.example.com/next.webp');
  offscreen.bounds = { left: 400, top: 80, right: 700, bottom: 280 }; gallery.append(offscreen);
  const unloaded = h.image('https://cdn.example.com/unloaded.webp'); unloaded.complete = false; gallery.append(unloaded);
  gallery.append(cover);
  h.hover(cover); h.click(); assert.equal(h.messages.at(-1).url, shown.currentSrc);
  shown.currentSrc = 'https://cdn.example.com/replaced.webp'; h.hover(cover); h.click();
  assert.equal(h.messages.at(-1).url, shown.currentSrc);
  shown.style.display = 'none'; offscreen.bounds = { left: 100, top: 80, right: 400, bottom: 280 };
  h.hover(cover); h.click(); assert.equal(h.messages.at(-1).url, offscreen.currentSrc);
});

test('images behind opaque covers, dialogs, and carousel controls do not get a download button', () => {
  const h = page(), gallery = new h.Element(), image = h.image(), cover = new h.Element();
  h.document.body.append(gallery); gallery.append(image); gallery.append(cover);
  cover.style.backgroundColor = 'rgb(20, 20, 20)'; h.hover(cover); assert.equal(h.button.style.display, 'none');
  cover.style.backgroundColor = 'transparent'; cover.setAttribute('role', 'dialog');
  h.hover(cover); assert.equal(h.button.style.display, 'none');
  cover.setAttribute('role', 'presentation');
  for (const tag of ['button', 'video', 'iframe']) {
    const control = new h.Element(tag); cover.append(control); h.hover(control);
    assert.equal(h.button.style.display, 'none', tag);
  }
  const arrow = new h.Element('div', { left: 360, top: 245, right: 390, bottom: 275 });
  arrow.setAttribute('role', 'button');
  const sprite = new h.Element('span', arrow.bounds);
  sprite.style.backgroundImage = 'url("https://cdn.example.com/icon-atlas.png")'; arrow.append(sprite); cover.append(arrow);
  h.hover(sprite); assert.equal(h.button.style.display, 'none', 'CSS sprite carousel arrows remain usable');
  cover.children = []; h.hover(cover); assert.equal(h.button.style.display, 'grid');
  const unrelated = new h.Element('p'); gallery.bounds = { left: 0, top: 0, right: 800, bottom: 600 };
  gallery.append(unrelated); h.hover(unrelated); assert.equal(h.button.style.display, 'none');
});

test('hit-test paint order wins over DOM order for overlapping gallery images', () => {
  const h = page(), gallery = new h.Element(), cover = new h.Element();
  const top = h.image('https://cdn.example.com/top.png'), behind = h.image('https://cdn.example.com/behind.png');
  h.document.body.append(gallery); gallery.append(top); gallery.append(behind); gallery.append(cover);
  h.document.elementsFromPoint = () => [cover, top, behind, gallery];
  h.hover(cover); h.click(); assert.equal(h.messages.at(-1).url, top.currentSrc);
});

test('deep feed overlays and partially visible photos do not require opening the comments dialog', () => {
  const h = page(), post = new h.Element('article', { left: 100, top: -800, right: 400, bottom: 500 });
  const image = h.image('https://cdn.example.com/scrolled-photo.jpg');
  image.bounds = { left: 100, top: -700, right: 400, bottom: 280 };
  const cover = new h.Element('div', image.bounds); h.document.body.append(post); post.append(image);
  let layer = post;
  for (let index = 0; index < 10; index++) { const child = new h.Element('div', post.bounds); layer.append(child); layer = child; }
  layer.append(cover); h.hover(cover); h.click();
  assert.equal(h.button.style.display, 'grid'); assert.equal(h.messages.at(-1)?.url, image.currentSrc);
  assert.equal(h.button.style.top, '248px', 'anchor inside the part visible after scrolling');
});

test('feed insertion and viewport observers find lazy photos without another pointer movement and release removed posts', () => {
  const h = page({ observe: true }), post = new h.Element(), image = h.image();
  h.document.body.append(post); post.append(image); image.complete = false;
  let layer = post;
  for (let index = 0; index < 10; index++) { const child = new h.Element(); layer.append(child); layer = child; }
  h.hover(layer); assert.equal(h.button.style.display, 'none');
  h.mutate([{ addedNodes: [post] }]); assert.equal(h.tracked.has(image), true);
  h.intersect(image); assert.equal(h.button.style.display, 'none');
  image.complete = true; h.document.fire('load');
  image.bounds = post.bounds = { left: 100, top: 80, right: 400, bottom: 270 };
  h.flush(); assert.equal(h.button.style.display, 'grid'); assert.equal(h.button.style.top, '238px');
  h.window.fire('blur'); h.flush(); h.mutate([{ type: 'attributes', target: image }]); h.flush();
  assert.equal(h.button.style.display, 'none', 'a feed update must not restore a button after leaving the page');
  image.isConnected = false; h.mutate([{ removedNodes: [post] }]); h.flush();
  assert.equal(h.tracked.has(image), false);
});

test('scroll hit testing runs after layout changes and skips offscreen indexed images', () => {
  const h = page({ observe: true }), post = new h.Element(), image = h.image();
  h.document.body.append(post); post.append(image);
  let layer = post;
  for (let index = 0; index < 10; index++) { const child = new h.Element(); layer.append(child); layer = child; }
  image.bounds = { left: 100, top: 800, right: 400, bottom: 1000 };
  h.hover(layer); h.mutate([{ addedNodes: [post] }]); h.intersect(image, false);
  assert.equal(h.button.style.display, 'none');
  h.document.fire('scroll'); image.bounds = { left: 100, top: 80, right: 400, bottom: 280 };
  h.intersect(image); assert.equal(h.button.style.display, 'grid');
  h.click(); assert.equal(h.messages.at(-1).url, image.currentSrc);
});

test('page body overflow propagated to the viewport does not hide photos after scrolling', () => {
  const h = page(), image = h.image();
  h.document.scrollingElement = h.document.documentElement;
  h.document.body.style.overflowX = 'hidden'; h.document.body.style.overflowY = 'auto';
  h.document.body.bounds = { left: 0, top: -1200, right: 800, bottom: -600 };
  h.hover(image); assert.equal(h.button.style.display, 'grid'); assert.equal(h.button.style.top, '248px');
  h.click(); assert.equal(h.messages.at(-1).url, image.currentSrc);
  h.document.documentElement.style.overflowY = 'auto';
  h.document.body.bounds = { left: 0, top: 0, right: 800, bottom: 250 };
  h.hover(image, 330, 230);
  assert.equal(h.button.style.top, '218px', 'body still clips when it is a separate scroll container');
  h.document.documentElement.style.overflowY = 'visible'; h.document.body.style.contain = 'paint';
  h.hover(image, 330, 230);
  assert.equal(h.button.style.top, '218px', 'containment disables body overflow propagation');
});

test('scrolling, clipping, lazy loading, CSS backgrounds, and replacement image sources update the hovered target', () => {
  const h = page(), image = h.image();
  image.complete = false; h.hover(image); assert.equal(h.button.style.display, 'none');
  image.complete = true; h.document.fire('load'); h.flush(); assert.equal(h.button.style.display, 'grid');
  const clip = new h.Element('div', { left: 100, top: 80, right: 350, bottom: 250 });
  clip.style.overflowX = 'hidden'; clip.style.overflowY = 'auto'; clip.append(image);
  h.hover(image, 330, 230); assert.equal(h.button.style.left, '318px'); assert.equal(h.button.style.top, '218px');
  h.scrollTo(null); assert.equal(h.button.style.display, 'none');
  const background = new h.Element(); background.style.backgroundImage = 'url("https://cdn.example.com/background.webp")';
  h.hover(background); h.click(); assert.equal(h.messages.at(-1).url, 'https://cdn.example.com/background.webp');
  h.hover(image, 330, 230); image.currentSrc = 'https://cdn.example.com/replacement.png'; h.click();
  assert.equal(h.messages.at(-1).url, image.currentSrc);
});

test('blob images and cache misses send original bytes through the native bridge; failures are retryable', async () => {
  const h = page(), image = h.image('blob:https://example.com/generated');
  h.response({ ok: true, blob: async () => ({ size: 4, type: 'image/png', data: 'AQIDBA==' }) });
  h.hover(image); h.click(); await h.settled();
  assert.equal(h.messages[0].data, 'AQIDBA=='); assert.equal(h.messages[0].mime, 'image/png');
  h.result(h.messages[0].id, 'error', { message: 'Downloads folder is unavailable. Click to retry.' });
  assert.match(h.button.title, /Downloads folder is unavailable/);
  image.currentSrc = 'https://example.com/uncached.png'; h.hover(image); h.click();
  const request = h.messages.at(-1); h.result(request.id, 'read-in-page'); await h.settled();
  assert.equal(h.messages.at(-1).data, 'AQIDBA==');
  assert.equal(h.messages.at(-1).id, request.id);
});

test('frame results reach their owning image and stale completions cannot overwrite a new source state', () => {
  const h = page(), forwarded = [], image = h.image();
  h.window.frames.push({ postMessage: (payload) => forwarded.push(payload) });
  h.hover(image); h.click(); const oldId = h.messages.at(-1).id;
  image.currentSrc = 'https://example.com/new.png'; h.hover(image); h.click();
  const newId = h.messages.at(-1).id;
  h.result(oldId, 'saved', { filename: 'old.png' });
  assert.equal(h.button.title, 'Saving image…'); assert.equal(forwarded.length, 1);
  h.result(newId, 'saved', { filename: 'new.png' }); assert.match(h.button.title, /Saved new.png/);
});

test('a failed fetch leaves a retry action and page exit ignores late blob reads', async () => {
  const h = page(), image = h.image('data:image/png;base64,AQID');
  h.hover(image); h.click(); await h.settled(); assert.match(h.button.title, /retry/);
  h.response({ ok: true, blob: async () => ({ size: 4, type: 'image/png', data: 'AQIDBA==' }) });
  h.click(); h.window.fire('pagehide'); await h.settled();
  assert.equal(h.messages.length, 0); assert.equal(h.button.style.display, 'none');
});
