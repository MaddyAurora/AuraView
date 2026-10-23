(() => {
  const token = __AURAVIEW_IMAGE_TOKEN__;
  const bridge = window.chrome?.webview;
  if (!bridge) return;
  const send = bridge.postMessage.bind(bridge);
  const stringify = JSON.stringify.bind(JSON);
  const pending = new Map();
  const states = new WeakMap();
  let host, button, icon, active, visibleImages, refreshTarget = false, frame = 0, lastX = -1, lastY = -1, leaving = false;
  const maxBytes = 100 * 1024 * 1024;
  const downloadPath = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';

  function mount() {
    if (host || !document.documentElement) return;
    host = document.createElement('auraview-image-tools');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 auto auto 0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important';
    const root = host.attachShadow({ mode: 'closed' });
    button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'all:initial;box-sizing:border-box;position:fixed;display:none;place-items:center;padding:5px;border:1px solid #ffffff55;border-radius:7px;background:#111923eF;color:#fff;box-shadow:0 2px 8px #0008;cursor:pointer;pointer-events:auto;user-select:none;line-height:1';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'width:100%;height:100%;pointer-events:none';
    icon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.append(icon); button.append(svg); root.append(button); document.documentElement.append(host);
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopImmediatePropagation(); });
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.isTrusted || !active || !active.element.isConnected) return;
      const image = imageForElement(active.element);
      if (!image) return;
      active = image;
      const previous = states.get(image.element);
      if (previous?.url === image.url && previous.status === 'saving') return;
      const id = crypto.randomUUID();
      states.set(image.element, { id, url: image.url, status: 'saving', title: 'Saving image…' });
      pending.set(id, image); render();
      if (/^(data|blob):/i.test(image.url)) readInPage(id, image);
      else post({ kind: 'auraview-image-download', token, id, url: image.url }, id);
    });
    watchImages();
  }

  function watchImages() {
    if (typeof IntersectionObserver === 'undefined') return;
    visibleImages = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target.isConnected) visibleImages.add(entry.target);
        else visibleImages.delete(entry.target);
      }
      schedule(true);
    });
    const track = (root, added) => {
      const images = root instanceof HTMLImageElement ? [root] : root.querySelectorAll?.('img') || [];
      for (const image of images) {
        if (added) observer.observe(image);
        else { observer.unobserve(image); visibleImages.delete(image); }
      }
    };
    track(document, true);
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes || []) track(node, false);
          for (const node of record.addedNodes || []) track(node, true);
        }
        schedule(true);
      }).observe(document.documentElement, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    }
  }

  function post(payload, id) {
    try { send(stringify(payload)); } catch { fail(id); }
  }

  function imageAtPointer(event) {
    const path = event?.composedPath?.() || [];
    if (path.includes(host)) return active;
    // Use the actual target inside shadow DOM, then look within its local media
    // container. Galleries often put a transparent sibling above the image or
    // give the image pointer-events:none, so elementFromPoint alone misses it.
    const hit = path.find((element) => element instanceof Element)
      || document.elementFromPoint(lastX, lastY);
    if (hit === host) return active;
    if (!(hit instanceof Element)) return;
    const stack = document.elementsFromPoint?.(lastX, lastY) || [];
    const seen = new Set();
    let remaining = 200;
    for (let scope = hit, depth = 0; scope && depth < 6; scope = parentOf(scope), depth++) {
      if (scope === document.body || scope === document.documentElement) break;
      const direct = imageForElement(scope);
      if (direct && isVisibleAtPointer(scope) && !obstructed(hit, direct, scope)) return direct;
      const scopeRect = visibleRect(scope);
      const accept = (element) => {
        const image = imageForElement(element);
        if (!image || !isVisibleAtPointer(element)) return;
        const rect = visibleRect(element);
        // Stay within a photo-sized container; never search a whole feed behind
        // a separate dialog, caption, player, or unrelated page content.
        if (scopeRect.width > rect.width * 1.75 + 2 || scopeRect.height > rect.height * 1.75 + 2) return;
        if (!obstructed(hit, image, scope)) return image;
      };
      // Respect paint order when the image participates in hit testing.
      for (const element of stack) {
        if (element !== scope && scope.contains(element)) {
          const image = accept(element);
          if (image) return image;
        }
      }
      // Also find pointer-events:none images. Bound traversal across all scopes
      // so a pointer move over a large feed cannot scan every loaded post.
      const nodes = [scope];
      while (nodes.length && remaining > 0) {
        const element = nodes.pop();
        if (seen.has(element)) continue;
        seen.add(element); remaining--;
        if (element !== scope) {
          const image = accept(element);
          if (image) return image;
        }
        for (const child of element.children || []) {
          if (nodes.length >= remaining) break;
          nodes.push(child);
        }
        if (element.shadowRoot) nodes.push(element.shadowRoot);
      }
    }
    // Infinite feeds can nest the cover far away from its image, or fill the
    // local traversal budget with other markup. Check viewport images as a
    // fallback, without walking every earlier/offscreen post on each move.
    for (const element of visibleImages || document.images || []) {
      if (!element.isConnected || !isVisibleAtPointer(element)) continue;
      const image = imageForElement(element);
      if (!image) continue;
      let scope = hit;
      while (scope && !scope.contains(element)) scope = parentOf(scope);
      if (!scope || scope === document.body || scope === document.documentElement) continue;
      // Compare complete boxes: clipping a tall photo at the viewport edge must
      // not make its own wrapper look disproportionately large.
      const container = scope.getBoundingClientRect(), photo = element.getBoundingClientRect();
      if (container.width > photo.width * 1.75 + 2 || container.height > photo.height * 1.75 + 2) continue;
      if (!obstructed(hit, image, scope)) return image;
    }
  }

  function parentOf(element) { return element.parentElement || element.getRootNode?.().host; }

  function isVisibleAtPointer(element) {
    const rect = visibleRect(element);
    if (rect.width <= 0 || rect.height <= 0 || lastX < rect.left || lastX > rect.right || lastY < rect.top || lastY > rect.bottom) return false;
    for (let node = element; node instanceof Element; node = parentOf(node)) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || /^(hidden|collapse)$/.test(style.visibility)
        || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  }

  function obstructed(hit, image, scope) {
    for (let node = hit; node && node !== scope; node = parentOf(node)) {
      if (node.contains(image.element)) break;
      const bounds = node.getBoundingClientRect();
      if (/^(BUTTON|INPUT|TEXTAREA|SELECT|VIDEO|AUDIO|IFRAME|OBJECT|EMBED)$/.test(node.tagName)
        || (node.getAttribute('role') === 'button' && bounds.width <= 64 && bounds.height <= 64)
        || node.getAttribute('role') === 'dialog' || node.getAttribute('aria-modal') === 'true') return true;
      const style = getComputedStyle(node);
      const color = style.backgroundColor || '';
      const alpha = color === 'transparent' ? 0 : color.startsWith('rgba(') ? Number(color.slice(5, -1).split(',')[3]) : color.startsWith('rgb(') ? 1 : 0;
      if (alpha >= 0.98 && Number(style.opacity || 1) >= 0.98) return true;
    }
    return false;
  }

  function imageForElement(hit) {
    if (hit instanceof HTMLImageElement) {
      if (!hit.complete || !hit.naturalWidth) return;
      const url = hit.currentSrc || hit.src;
      if (/^(https?|data|blob|file):/i.test(url)) return { element: hit, url };
      return;
    }
    // A single CSS background is also an image, e.g. a gallery card thumbnail.
    if (hit instanceof Element && hit !== document.body && hit !== document.documentElement) {
      const background = getComputedStyle(hit).backgroundImage;
      const match = /^url\(["']?(.*?)["']?\)$/.exec(background);
      if (match && /^(https?|data|blob|file):/i.test(match[1])) {
        // Carousel arrows commonly use CSS sprite sheets. Keep these controls
        // clickable rather than offering to download the whole icon atlas.
        for (let node = hit; node instanceof Element; node = parentOf(node)) {
          if (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(node.tagName) || node.getAttribute('role') === 'button') return;
        }
        return { element: hit, url: match[1] };
      }
    }
  }

  function visibleRect(element) {
    const bounds = element.getBoundingClientRect();
    let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
    let right = Math.min(window.innerWidth, bounds.right), bottom = Math.min(window.innerHeight, bounds.bottom);
    for (let parent = parentOf(element); parent; parent = parentOf(parent)) {
      // Root overflow clips the viewport, not the root's scrolled bounding box.
      // HTML also propagates body overflow to the viewport when root overflow
      // is visible; clipping against that body's box hides images as we scroll.
      if (parent === document.documentElement || parent === document.scrollingElement) continue;
      const style = getComputedStyle(parent);
      if (parent === document.body) {
        const root = getComputedStyle(document.documentElement);
        const contained = [root.contain, style.contain].some((value) => value && value !== 'none');
        if (!contained && root.overflowX === 'visible' && root.overflowY === 'visible') continue;
      }
      const clip = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function render() {
    mount();
    if (!button) return;
    if (!active?.element.isConnected || leaving || document.hidden) { button.style.display = 'none'; return; }
    active = imageForElement(active.element);
    if (!active || !isVisibleAtPointer(active.element)) { button.style.display = 'none'; return; }
    const rect = visibleRect(active.element);
    const size = Math.min(28, rect.width - 4, rect.height - 4);
    if (size < 12 || lastX < rect.left || lastX > rect.right || lastY < rect.top || lastY > rect.bottom) {
      active = undefined; button.style.display = 'none'; return;
    }
    const stored = states.get(active.element);
    const state = stored?.url === active.url ? stored : undefined;
    const status = state?.status;
    icon.setAttribute('d', status === 'saved' ? 'M5 12l4 4L19 6' : status === 'error' ? 'M12 8v5M12 17h.01M12 3 2 21h20L12 3' : downloadPath);
    button.style.color = status === 'saved' ? '#67e8a4' : status === 'error' ? '#fca5a5' : '#fff';
    button.style.opacity = status === 'saving' ? '0.65' : '1';
    button.setAttribute('aria-label', state?.title || 'Download image');
    button.title = state?.title || 'Download image';
    button.style.left = `${Math.max(rect.left, rect.right - size - 4)}px`;
    button.style.top = `${Math.max(rect.top, rect.bottom - size - 4)}px`;
    button.style.width = `${size}px`; button.style.height = `${size}px`; button.style.display = 'grid';
  }

  function schedule(recheck = false) {
    refreshTarget ||= recheck;
    if (frame || leaving) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (refreshTarget) { refreshTarget = false; active = imageAtPointer(); }
      render();
    });
  }

  function fail(id, message) {
    const image = pending.get(id);
    if (!image) return;
    pending.delete(id);
    if (states.get(image.element)?.id === id) states.set(image.element,
      { id, url: image.url, status: 'error', title: message || 'Could not save image. Click to retry.' });
    schedule();
  }

  async function readInPage(id, image) {
    try {
      const response = await fetch(image.url, { credentials: 'include' });
      if (!response.ok) throw new Error('Image request failed');
      const blob = await response.blob();
      if (!blob.size || blob.size > maxBytes || !blob.type.startsWith('image/')) throw new Error('Invalid image');
      const reader = new FileReader();
      reader.onload = () => {
        if (leaving || !pending.has(id)) return;
        const data = String(reader.result).split(',')[1];
        post({ kind: 'auraview-image-download', token, id, url: image.url, mime: blob.type, data }, id);
      };
      reader.onerror = () => fail(id);
      reader.readAsDataURL(blob);
    } catch { fail(id, image.nativeError); }
  }

  function result(payload) {
    if (!payload || payload.kind !== 'auraview-image-result') return;
    // Forward results to embedded documents, including cross-origin iframes.
    for (let index = 0; index < window.frames.length; index++) {
      try { window.frames[index].postMessage(payload, '*'); } catch { /* frame navigated */ }
    }
    const image = pending.get(payload.id);
    if (!image) return;
    if (payload.status === 'read-in-page') { image.nativeError = payload.message; readInPage(payload.id, image); return; }
    if (payload.status !== 'saved') { fail(payload.id, payload.message); return; }
    pending.delete(payload.id);
    if (states.get(image.element)?.id === payload.id) states.set(image.element,
      { id: payload.id, url: image.url, status: 'saved', title: `Saved ${payload.filename} to Downloads` });
    schedule();
  }

  window.addEventListener('pointermove', (event) => {
    if (!event.isTrusted || event.pointerType === 'touch') return;
    lastX = event.clientX; lastY = event.clientY;
    active = imageAtPointer(event); schedule();
  }, { capture: true, passive: true });
  function hide() { active = undefined; lastX = lastY = -1; schedule(); }
  document.addEventListener('scroll', () => schedule(true), { capture: true, passive: true });
  document.addEventListener('load', () => schedule(true), true);
  document.addEventListener('pointerleave', hide);
  document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) hide(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); else schedule(true); });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', () => schedule(true));
  window.addEventListener('auraview-image-result', (event) => result({ ...event.detail, kind: 'auraview-image-result' }));
  window.addEventListener('message', (event) => { if (event.source === window.parent && window.parent !== window) result(event.data); });
  window.addEventListener('pagehide', () => { leaving = true; cancelAnimationFrame(frame); frame = 0; pending.clear(); if (button) button.style.display = 'none'; });
  window.addEventListener('pageshow', () => { leaving = false; active = undefined; schedule(); });
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
})();
