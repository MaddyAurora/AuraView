(() => {
  // Observe existing loads. Never fetch, retain media bodies, or select the
  // newest request globally: a feed may be preloading several other players.
  const resources = new Map(), sources = new Map(), buffers = new WeakMap(), origins = new WeakMap(), samples = new Map();
  const mediaKind = (url, mime = '') => /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(mime) ? 'manifest'
    : /\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(mime) ? 'manifest'
    : /\.(mp4|webm|m4a|mov)(?:[?#]|$)/i.test(url) || /^(video|audio)\//i.test(mime) ? 'file' : '';
  function http(value) { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
  function remember(value, mime = '') {
    const url = http(value); if (!url) return;
    const previous = resources.get(url), kind = mediaKind(url, mime) || previous?.kind;
    if (!kind) return;
    const record = previous || { url, kind, mime, children: new Set(), master: false };
    if (mime) record.mime = mime; record.kind = kind;
    resources.delete(url); resources.set(url, record);
    while (resources.size > 256) resources.delete(resources.keys().next().value);
    return record;
  }
  function manifest(record, text) {
    if (record?.kind !== 'manifest' || typeof text !== 'string' || text.length > 1024 * 1024) return;
    record.master = /#EXT-X-STREAM-INF|#EXT-X-MEDIA:|<MPD[\s>]/i.test(text);
    // HLS relationships make an observed media segment attributable to its
    // master playlist, including a separate audio rendition.
    if (text.startsWith('#EXTM3U')) {
      for (const line of text.split(/\r?\n/)) {
        const references = line.startsWith('#') ? [...line.matchAll(/URI="([^"\r\n]+)"/g)].map(m => m[1]) : [line.trim()];
        for (const reference of references) if (reference && !reference.startsWith('#')) {
          try { const url = http(new URL(reference, record.url).href); if (url && record.children.size < 1024) record.children.add(url); } catch { /* malformed playlist URL */ }
        }
      }
    }
  }
  function bytes(value) {
    try { return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value instanceof ArrayBuffer ? new Uint8Array(value) : undefined; } catch { return; }
  }
  function fingerprint(value) {
    const data = bytes(value); if (!data?.length) return '';
    let hash = 2166136261;
    // Bounded sampling identifies transferred buffers without keeping a copy.
    for (let i = 0, n = Math.min(data.length, 512); i < n; i++) hash = Math.imul(hash ^ data[i], 16777619);
    for (let i = Math.max(512, data.length - 512); i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
    return `${data.length}:${hash >>> 0}`;
  }
  function body(record, value) {
    if (!record) return;
    if (typeof value === 'string') { manifest(record, value); return; }
    const data = bytes(value); if (!data) return;
    origins.set(data.buffer, record);
    const key = fingerprint(data); if (key) {
      const previous = samples.get(key);
      samples.set(key, previous === false || (previous && previous.url !== record.url) ? false : record);
      while (samples.size > 128) samples.delete(samples.keys().next().value);
    }
  }
  function wrap(object, name, decorate) {
    try { const original = object?.[name]; if (typeof original === 'function') object[name] = decorate(original); } catch { /* immutable browser API */ }
  }
  wrap(globalThis.URL, 'createObjectURL', original => function (object) {
    const url = Reflect.apply(original, this, arguments);
    if (typeof MediaSource !== 'undefined' && object instanceof MediaSource) {
      if (typeof WeakRef !== 'undefined') sources.set(url, new WeakRef(object));
      while (sources.size > 64) sources.delete(sources.keys().next().value);
    }
    return url;
  });
  wrap(globalThis.URL, 'revokeObjectURL', original => function (url) { sources.delete(url); return Reflect.apply(original, this, arguments); });
  if (typeof MediaSource !== 'undefined') wrap(MediaSource.prototype, 'addSourceBuffer', original => function (mime) {
    const buffer = Reflect.apply(original, this, arguments); buffers.set(buffer, { source: this, mime, record: undefined }); return buffer;
  });
  if (typeof SourceBuffer !== 'undefined') wrap(SourceBuffer.prototype, 'appendBuffer', original => function (value) {
    const binding = buffers.get(this), data = bytes(value);
    const record = data && (origins.get(data.buffer) || samples.get(fingerprint(data)));
    const result = Reflect.apply(original, this, arguments);
    // A reused player can switch from the main video to an ad. An unknown
    // append invalidates its old attribution instead of retaining that video.
    if (binding) binding.record = record || undefined;
    return result;
  });
  // SourceBuffers are enumerable through their MediaSource; the weak map above
  // associates only buffers whose actual appended bytes came from a known load.
  if (typeof Response !== 'undefined') {
    for (const method of ['arrayBuffer', 'text']) wrap(Response.prototype, method, original => function () {
      const record = remember(this.url, this.headers?.get('content-type') || '');
      return Reflect.apply(original, this, arguments).then(value => { try { body(record, value); } catch { /* keep the page's original result */ } return value; });
    });
  }
  if (typeof XMLHttpRequest !== 'undefined') wrap(XMLHttpRequest.prototype, 'send', original => function () {
    this.addEventListener('load', () => {
      try { body(remember(this.responseURL, this.getResponseHeader('content-type') || ''), this.response); } catch { /* inaccessible response */ }
    }, { once: true });
    return Reflect.apply(original, this, arguments);
  });
  try {
    for (const entry of globalThis.performance?.getEntriesByType?.('resource') || []) remember(entry.name);
    if (typeof PerformanceObserver !== 'undefined') new PerformanceObserver(list => {
      for (const entry of list.getEntries()) remember(entry.name);
    }).observe({ type: 'resource', buffered: true });
  } catch { /* timing API unavailable */ }
  function family(value) {
    return /\/(?:amplify_video(?:_thumb)?|ext_tw_video(?:_thumb)?)\/(\d+)(?:\/|$)/.exec(value || '')?.[1]
      || /\/tweet_video(?:_thumb)?\/([^/.?]+)/.exec(value || '')?.[1];
  }
  function reaches(record, url, seen = new Set()) {
    if (seen.has(record.url) || seen.size >= 64) return false; seen.add(record.url);
    if (record.children.has(url)) return true;
    return [...record.children].some(child => resources.has(child) && reaches(resources.get(child), url, seen));
  }
  function masterFor(records) {
    const manifests = [...resources.values()].filter(r => r.kind === 'manifest' && records.every(child => child.url === r.url || reaches(r, child.url)));
    const masters = manifests.filter(r => r.master);
    return masters.length === 1 ? masters[0] : manifests.length === 1 ? manifests[0] : undefined;
  }
  function fileUrl(record) {
    const u = new URL(record.url);
    // YouTube fetches ranges using a query parameter rather than a Range header.
    // A complete URL can be requested only when 'range' is not signature-bound.
    if (u.hostname.endsWith('.googlevideo.com') && !(u.searchParams.get('sparams') || '').split(',').includes('range')) u.searchParams.delete('range');
    return /\.(mp4|webm|m4a|mov)$/i.test(u.pathname) || /\/videoplayback$/.test(u.pathname) ? u.href : '';
  }
  function hints(video, { singlePlayer = false, boundOnly = false } = {}) {
    // Include entries that arrived before an observer callback was delivered.
    try { for (const entry of globalThis.performance?.getEntriesByType?.('resource') || []) remember(entry.name); } catch { /* timing API unavailable */ }
    const source = sources.get(video.currentSrc || video.src)?.deref();
    const sourceBuffers = source ? Array.from(source.sourceBuffers) : [];
    const bindings = sourceBuffers.map(buffer => buffers.get(buffer)).filter(binding => binding?.record);
    if (bindings.length && bindings.length === sourceBuffers.length) {
      const master = masterFor(bindings.map(binding => binding.record));
      if (master) return [{ url: master.url, kind: 'manifest', mime: master.mime }];
      const files = bindings.map(binding => ({ url: fileUrl(binding.record),
        kind: /^audio\//i.test(binding.mime) ? 'audio' : /mp4a|opus|vorbis/i.test(binding.mime) ? 'combined' : 'video', mime: binding.mime }));
      if (files.every(file => file.url) && files.some(file => file.kind !== 'audio')) return files.slice(0, 4);
    }
    // X's poster and HLS resources share a stable media ID, even for promoted
    // posts and timelines whose blob URL does not reveal the source.
    const identity = family(video.poster);
    if (identity && !boundOnly) {
      const matching = [...resources.values()].filter(record => family(record.url) === identity);
      const masters = matching.filter(record => record.kind === 'manifest' && record.master);
      const manifests = matching.filter(record => record.kind === 'manifest');
      const record = masters.length === 1 ? masters[0] : manifests.length === 1 ? manifests[0] : undefined;
      if (record) return [{ url: record.url, kind: 'manifest', mime: record.mime }];
      const files = matching.filter(record => fileUrl(record));
      if (files.length === 1) return [{ url: files[0].url, kind: 'combined', mime: files[0].mime }];
    }
    if (singlePlayer && !boundOnly) {
      const manifests = [...resources.values()].filter(record => record.kind === 'manifest');
      const roots = manifests.filter(record => !manifests.some(other => other !== record && reaches(other, record.url)));
      // A page with two unrelated streams must never download whichever one
      // happened to load last. Unknown feeds remain ambiguous.
      if (roots.length === 1) return [{ url: roots[0].url, kind: 'manifest', mime: roots[0].mime }];
    }
    return [];
  }
  return { hints };
})()
