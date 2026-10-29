(() => {
  const token = __AURAVIEW_VIDEO_TOKEN__;
  const bridge = window.chrome?.webview;
  if (!bridge) return;
  const send = bridge.postMessage.bind(bridge), stringify = JSON.stringify.bind(JSON);
  const states = new WeakMap(), pending = new Map(), videos = new Set(), encrypted = new WeakSet();
  const mediaStreams = __AURAVIEW_MEDIA_STREAMS__;
  let host, button, icon, badge, menu, menuRequest, menuKey = '', menuButtons = [], active, focused, pinned, observer, resizeObserver, frame = 0, leaving = false, recheckPending = false, x = -1, y = -1;
  let pointerIdle = false, idleTimer = 0;
  function clearIdleTimer() { clearTimeout(idleTimer); idleTimer = 0; }
  function showTemporarily() {
    pointerIdle = false;
    clearIdleTimer();
    idleTimer = setTimeout(() => { idleTimer = 0; pointerIdle = true; schedule(); }, 3000);
  }
  const roots = new WeakSet();
  const download = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3';
  const busy = (status) => ['preparing', 'downloading', 'merging', 'saving', 'cancelling'].includes(status);
  const parent = (node) => node.parentElement || node.getRootNode?.().host;
  function track(root) {
    if (!root.querySelectorAll) return;
    if (root instanceof HTMLVideoElement) { videos.add(root); resizeObserver?.observe(root); }
    for (const v of root.querySelectorAll('video')) { videos.add(v); resizeObserver?.observe(v); }
    for (const element of [root, ...root.querySelectorAll('*')]) if (element.shadowRoot) {
      track(element.shadowRoot); watchRoot(element.shadowRoot);
    }
  }
  function watchRoot(root) {
    if (roots.has(root)) return;
    roots.add(root);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'hidden'] });
  }
  function rectFor(video) {
    const b = video.getBoundingClientRect();
    let left = Math.max(0, b.left), top = Math.max(0, b.top), right = Math.min(innerWidth, b.right), bottom = Math.min(innerHeight, b.bottom);
    for (let node = video; node instanceof Element; node = parent(node)) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || /^(hidden|collapse)$/.test(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return;
      if (node === video || node === document.documentElement || node === document.scrollingElement || node === document.body) continue;
      const r = node.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
      if (/(hidden|clip|scroll|auto)/.test(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
    }
    return right - left >= 64 && bottom - top >= 48 ? { left, top, right, bottom } : undefined;
  }
  function playable(video) { return video.isConnected && video.readyState >= 1 && video.videoWidth > 0 && rectFor(video); }
  function videoAt(event) {
    const path = event?.composedPath?.() || [];
    if (path.includes(host)) return active;
    const hits = document.elementsFromPoint(x, y);
    const hit = path.find((node) => node instanceof Element) || hits[0];
    if (!hit) return;
    // The closed shadow root retargets elementFromPoint() to this host. Page
    // mutations schedule a second hit test without an event path; keep the
    // owning video instead of hiding the button from underneath the pointer.
    if (hit === host) return active && playable(active) ? active : undefined;
    for (const node of path) if (node instanceof HTMLVideoElement) videos.add(node);
    const candidates = [...videos].filter((video) => {
      const r = playable(video);
      return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }).sort((a, b) => (a === hit ? -1 : b === hit ? 1 : hits.indexOf(a) < 0 ? 1 : -1));
    for (const video of candidates) {
      let scope = hit;
      for (let depth = 0; scope && depth < 9; depth++, scope = parent(scope)) {
        if (scope === document.body || scope === document.documentElement) break;
        if (!scope.contains(video) && scope !== parent(video)) continue;
        const bounds = scope.getBoundingClientRect(), r = video.getBoundingClientRect();
        if (bounds.width > r.width * 1.8 + 2 || bounds.height > r.height * 1.8 + 2) break;
        let blocked = false;
        for (let node = hit; node && node !== scope && node !== video; node = parent(node)) {
          if (node.contains(video)) break;
          // Player controls fade between opaque and transparent backgrounds as
          // the pointer moves. They still belong to this same player. Actual
          // dialogs and unrelated embedded players remain obstructions.
          if (node.matches('dialog,[role="dialog"],[aria-modal="true"],iframe,video')) { blocked = true; break; }
        }
        if (!blocked) return video;
        break;
      }
    }
  }
  function watchPageLink(u) {
    if (!/^https?:$/.test(u.protocol)) return;
    if (/(^|\.)pornhub\.com$/.test(u.hostname)) {
      const keys = u.searchParams.getAll('viewkey');
      const id = /^\/(?:view_video\.php|video\/show)$/.test(u.pathname)
        ? (keys.length === 1 ? keys[0] : '') : /^\/embed\/([a-z0-9]+)\/?$/.exec(u.pathname)?.[1];
      if (id && /^[a-z0-9]+$/.test(id)) return `${u.origin}/view_video.php?viewkey=${id}`;
    }
    if (/(^|\.)xvideos\.com$/.test(u.hostname)
      && /^\/video(?:\.[a-z0-9]+|\d+)(?:\/[^/]+)?\/?$/.test(u.pathname)) {
      return `${u.origin}${u.pathname}`;
    }
  }
  function mediaLink(value) {
    try {
      const u = new URL(value, location.href), h = u.hostname;
      if (!/^https?:$/.test(u.protocol)) return;
      const watch = watchPageLink(u);
      if (watch) return watch;
      if (/(^|\.)youtube\.com$/.test(h)) {
        const id = u.searchParams.get('v') || /^\/(?:shorts|embed)\/([^/?]+)/.exec(u.pathname)?.[1];
        if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      }
      if (h === 'youtu.be' && u.pathname.length > 1) return `https://www.youtube.com/watch?v=${encodeURIComponent(u.pathname.slice(1))}`;
      if (/(^|\.)reddit\.com$/.test(h)) {
        const post = /^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/[^/]+)?\/?$/i.exec(u.pathname);
        if (post) return `https://www.reddit.com/comments/${post[1]}/`;
      }
      if (/(^|\.)(x|twitter)\.com$/.test(h)) {
        const post = /^\/(?:[^/]+\/status|i\/web\/status|statuses)\/(\d+)(?:\/video\/(\d+))?\/?$/.exec(u.pathname);
        if (post) return `https://x.com/i/status/${post[1]}${post[2] ? `/video/${post[2]}` : ''}`;
      }
      if (/(^|\.)instagram\.com$/.test(h)) {
        // A story URL needs its numeric item ID; the account/highlight URL is
        // a collection and must never download an arbitrary story from it.
        const story = /^\/stories\/([A-Za-z0-9_.]+)\/(\d+)\/?$/.exec(u.pathname);
        if (story && story[1].toLowerCase() !== 'highlights') return `https://www.instagram.com/stories/${story[1]}/${story[2]}/`;
        // /reels/audio/<id>/ is a soundtrack page, not the post under the pointer.
        const post = /^\/(?:[^/]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
        if (post) return `https://www.instagram.com/${/^reel/.test(post[1]) ? 'reel' : post[1]}/${post[2]}/`;
      }
    } catch { /* not a media permalink */ }
  }
  function instagramMedia(video) {
    const result = { poster: video.poster || '', playerId: '' };
    // Instagram's streaming player keeps its media ID (and sometimes
    // poster) in the owning React component. Read only that player's metadata; do
    // not search shared stores, children, or neighboring story components.
    try {
      let fiber = video[Object.keys(video).find(key => key.startsWith('__reactFiber$'))];
      for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        const metadata = props?.coreVideoPlayerMetaData || props?.coreVideoPlayerProps?.coreVideoPlayerMetaData;
        if (!metadata) continue;
        const poster = metadata.poster;
        result.poster ||= typeof poster === 'string' ? poster : poster?.uri || poster?.url || '';
        if (typeof metadata.videoFBID === 'string' && /^\d+$/.test(metadata.videoFBID)) result.playerId = metadata.videoFBID;
        return result;
      }
    } catch { /* player internals may change; keep normal extraction available */ }
    return result;
  }
  function redditPlayerManifest(video) {
    // Reddit's player exposes its complete playlist on the owning custom
    // element, even when its video uses a blob and byte-range media requests.
    // Walk through shadow hosts so a feed never borrows a neighboring player.
    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return;
    for (let node = parent(video), depth = 0; node && depth < 32; depth++, node = parent(node)) {
      if (!node.matches?.('shreddit-player')) continue;
      try {
        const url = new URL(node.getAttribute('src') || '', location.href);
        if (url.protocol === 'https:' && url.hostname === 'v.redd.it' && !url.username && !url.password
          && /^\/[a-z0-9]+\/(?:HLSPlaylist\.m3u8|DASHPlaylist\.mpd)$/i.test(url.pathname)) {
          return { url: url.href, kind: 'manifest', mime: '' };
        }
      } catch { /* invalid player URL */ }
      return;
    }
  }
  function redditVideoTitle(video) {
    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return '';
    for (let node = parent(video), depth = 0; node && depth < 32; depth++, node = parent(node)) {
      if (node.matches?.('shreddit-player,shreddit-post')) {
        const title = node.getAttribute('post-title')?.trim();
        if (title) return title.slice(0, 1024);
      }
    }
    return mediaLink(location.href) ? document.title.replace(/\s*:\s*r\/[^\s]+\s*$/i, '').trim().slice(0, 1024) : '';
  }
  function target(video) {
    let url = video.currentSrc || video.src || '', pageUrl = '', ambiguous = false;
    const instagram = /(^|\.)instagram\.com$/.test(location.hostname);
    const twitter = /(^|\.)(x|twitter)\.com$/.test(location.hostname);
    const reddit = /(^|\.)reddit\.com$/.test(location.hostname);
    // Feed links must belong to this player. Never use the first link on a page.
    for (let scope = parent(video), depth = 0; scope && depth < 32; depth++, scope = parent(scope)) {
      if (scope === document.body || scope === document.documentElement) break;
      const players = scope.querySelectorAll('video');
      if (players.length > 1) { ambiguous = true; break; }
      // Reddit cards carry their own permalink even when the player and title
      // are separated by shadow roots or no visible anchor wraps the video.
      if (reddit && scope.matches('shreddit-post')) {
        const permalink = scope.getAttribute('permalink');
        const post = permalink && mediaLink(permalink);
        if (post) { pageUrl = post; break; }
      }
      const anchors = [...(scope.matches('a[href]') ? [scope] : []), ...scope.querySelectorAll('a[href]')];
      const links = new Map();
      for (const anchor of anchors) {
        const link = mediaLink(anchor.href);
        if (!link) continue;
        if (instagram && !new URL(link).hostname.endsWith('instagram.com')) continue;
        if (twitter && new URL(link).hostname !== 'x.com') continue;
        if (reddit && new URL(link).hostname !== 'www.reddit.com') continue;
        // Instagram puts both /p/<code>/ timestamps and /reels/<code>/ player
        // links on the same card. They identify one video, not two candidates.
        const path = new URL(link).pathname.split('/');
        const id = instagram ? (path[1] === 'stories' ? `story:${path[3]}` : `post:${path[2]}`) : link;
        if (!links.has(id)) links.set(id, link);
      }
      if (links.size === 1) { pageUrl = [...links.values()][0]; break; }
      if (links.size > 1) { ambiguous = true; break; }
      // An article is a post boundary. Don't inherit links from a neighboring
      // post merely because this card has no permalink of its own.
      if ((instagram || twitter || reddit) && scope.matches('article,shreddit-post')) break;
    }
    const visible = [...videos].filter(playable);
    if (!pageUrl && !ambiguous && visible.length === 1 && visible[0] === video) {
      pageUrl = mediaLink(location.href) || (!instagram && !twitter && !reddit && /^https?:$/.test(location.protocol) ? location.href : '');
    }
    // A YouTube media URL may contain video only; always resolve its watch URL.
    const youtube = /(^|\.)(youtube\.com|youtu\.be)$/.test(location.hostname);
    // Watch players can contain end-screen links to unrelated videos. Their
    // current route identifies the main player even while recommendations load.
    if (youtube && /^(\/watch|\/embed\/)/.test(location.pathname) && video.closest?.('#movie_player')) pageUrl = mediaLink(location.href) || '';
    // Shorts/Reels/Stories preload adjacent players. Only the dominant visible
    // player may use the route. A story may contain a link to a reshared post;
    // the current story ID takes precedence over that unrelated permalink.
    const route = mediaLink(location.href), storyRoute = instagram && route?.includes('/stories/');
    // Recognized watch pages can retain ad/preview video elements after the
    // main player starts streaming. Their dominant player still owns the route,
    // including when its controls contain links to recommended videos.
    const watchRoute = watchPageLink(new URL(location.href));
    if (route && (!pageUrl || storyRoute || watchRoute)) {
      const area = (v) => { const r = rectFor(v); return r ? (r.right - r.left) * (r.bottom - r.top) : 0; };
      let candidates = visible;
      if (watchRoute) {
        const r = rectFor(video);
        // A finished ad can remain underneath the main video at exactly the
        // same bounds. Count that slot once only when the selected video is
        // actually above it; separate players still make the route ambiguous.
        const top = r && document.elementsFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
          .find(node => node instanceof HTMLVideoElement);
        if (top === video) candidates = visible.filter(other => {
          if (other === video) return true;
          const bounds = rectFor(other);
          return !bounds || ['left', 'right', 'top', 'bottom'].some(side => Math.abs(bounds[side] - r[side]) > 2);
        });
      }
      const ordered = [...candidates].sort((a, b) => area(b) - area(a));
      if (ordered[0] === video && (ordered.length === 1 || area(ordered[0]) > area(ordered[1]) * 1.5)) pageUrl = route;
    }
    // Account-only story routes can also contain a reshared Reel link. Resolve
    // the story's player data instead of downloading that separate post.
    if (instagram && /^\/stories\//.test(location.pathname) && !pageUrl.includes('/stories/')) pageUrl = '';
    if (youtube && !/youtube\.com\/watch\?v=/.test(pageUrl)) pageUrl = '';
    const ad = youtube && Boolean(video.closest?.('.ad-showing'));
    // During a YouTube ad, the watch route still belongs to the main video.
    // Only the media bound to the current player may identify that download.
    if (ad) pageUrl = '';
    const { poster, playerId } = instagram ? instagramMedia(video) : { poster: '', playerId: '' };
    return { url, pageUrl, poster, playerId, title: ad ? 'Video advertisement' : redditVideoTitle(video) || video.getAttribute('aria-label') || document.title || 'Video',
      key: `${url}\n${pageUrl}\n${poster}\n${playerId}`, youtube, ad: youtube && Boolean(video.closest?.('.ad-showing')), drm: Boolean(video.mediaKeys || encrypted.has(video)), live: video.duration === Infinity };
  }
  function post(payload) { try { send(stringify({ ...payload, token })); } catch { return false; } return true; }
  function closeMenu(cancel = false) {
    if (cancel && menuRequest && pending.has(menuRequest.state.id)) {
      post({ kind: 'auraview-video-cancel', id: menuRequest.state.id });
      menuRequest.state.status = 'cancelling';
    }
    menuRequest = undefined; menuKey = ''; menuButtons = [];
    if (menu) menu.style.display = 'none';
    button?.setAttribute('aria-expanded', 'false');
  }
  function renderMenu(r) {
    if (!menuRequest) return;
    const { state, video } = menuRequest;
    if (!video.isConnected || target(video).key !== state.key || state.status !== 'preparing') {
      closeMenu(state.status === 'preparing'); return;
    }
    const choices = state.resolutions || [], audio = state.audioOption, key = `${state.id}:${choices.join(',')}:${audio || ''}`;
    if (key !== menuKey) {
      menuKey = key; menuButtons = []; menu.replaceChildren();
      const heading = document.createElement('div');
      heading.textContent = 'Download video or audio';
      heading.style.cssText = 'padding:7px 10px;color:#a7b6c8;font:11px system-ui';
      menu.append(heading);
      const select = (e, choice, message) => {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.isTrusted || menuRequest?.state !== state || target(video).key !== state.key) return;
        if (post({ kind: 'auraview-video-select', id: state.id, ...choice })) {
          state.resolutions = []; state.audioOption = null; state.message = message;
          closeMenu(); showTemporarily(); button.focus({ preventScroll: true }); render();
        }
      };
      for (const resolution of choices.length ? choices : [null]) {
        const option = document.createElement('button'); option.type = 'button';
        option.textContent = resolution == null ? 'Video · Best available' : `${resolution}p${resolution === choices[0] ? ' · Best quality' : ''}`;
        option.setAttribute('role', 'menuitem');
        option.style.cssText = 'all:initial;box-sizing:border-box;display:block;width:100%;padding:9px 10px;border-radius:5px;color:#fff;font:12px system-ui;cursor:pointer';
        option.addEventListener('click', (e) => select(e, resolution == null ? {} : { resolution }, `Preparing ${resolution == null ? '' : `${resolution}p `}video…`));
        menuButtons.push(option); menu.append(option);
      }
      if (audio) {
        const option = document.createElement('button'); option.type = 'button';
        option.textContent = audio === 'download' ? 'Download MP3' : 'Convert to MP3';
        option.title = audio === 'download' ? 'Download the audio track as an MP3' : 'Extract audio from a cached video and save as MP3';
        option.setAttribute('role', 'menuitem');
        option.style.cssText = 'all:initial;box-sizing:border-box;display:block;width:100%;margin-top:4px;padding:10px;border-top:1px solid #ffffff20;border-radius:5px;color:#67e8f9;font:12px system-ui;cursor:pointer';
        option.addEventListener('click', (e) => select(e, { audioOnly: true }, 'Preparing MP3 audio…'));
        menuButtons.push(option); menu.append(option);
      }
    }
    menu.style.left = `${Math.max(6, r.right - 206)}px`;
    // Fit the complete list, reserving scrolling only for windows shorter than
    // the menu. Measure its rendered height so positioning follows the content.
    menu.style.maxHeight = `${Math.max(0, innerHeight - 12)}px`;
    menu.style.display = 'block';
    const height = menu.getBoundingClientRect().height;
    const below = r.top + 42;
    menu.style.top = `${Math.max(6, Math.min(below, innerHeight - height - 6))}px`;
    menu.style.display = 'block'; button.setAttribute('aria-expanded', 'true');
  }
  function mount() {
    if (host || !document.documentElement) return;
    host = document.createElement('auraview-video-tools');
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 auto auto 0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;background:transparent!important;z-index:2147483647!important;pointer-events:none!important';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = 'button:focus-visible{outline:2px solid #67e8f9!important;outline-offset:2px}button:hover{background:#253449!important}';
    button = document.createElement('button'); button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    button.style.cssText = 'all:initial;box-sizing:border-box;position:fixed;display:none;width:32px;height:32px;padding:6px;border:1px solid #ffffff55;border-radius:8px;background:#111923ef;color:white;box-shadow:0 2px 8px #0008;cursor:pointer;pointer-events:auto;user-select:none';
    // YouTube enforces Trusted Types: build the icon through DOM APIs rather
    // than assigning HTML, which would prevent the entire overlay from rendering.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    svg.style.cssText = 'width:100%;height:100%;pointer-events:none';
    icon = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.append(icon); button.append(svg);
    badge = document.createElement('span');
    badge.style.cssText = 'all:initial;position:fixed;display:none;padding:3px 6px;border-radius:5px;background:#111923ef;color:white;font:11px system-ui;pointer-events:none';
    menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Video and MP3 download');
    menu.style.cssText = 'all:initial;box-sizing:border-box;position:fixed;display:none;width:200px;padding:4px;border:1px solid #ffffff33;border-radius:9px;background:#111923fa;color:white;box-shadow:0 8px 24px #0008;pointer-events:auto;overflow-y:auto;overscroll-behavior:contain';
    menu.addEventListener('pointerdown', (e) => e.stopImmediatePropagation());
    root.append(style, button, badge, menu); document.documentElement.append(host);
    lift();
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopImmediatePropagation(); });
    button.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.isTrusted || !active || !playable(active)) return;
      const info = target(active), previous = states.get(active);
      if (previous?.status === 'preparing' && previous.key === info.key && (previous.resolutions?.length > 1 || previous.audioOption) && !menuRequest) {
        menuRequest = { video: active, state: previous }; render(); return;
      }
      if (previous && busy(previous.status) && previous.key === info.key) {
        closeMenu();
        if (post({ kind: 'auraview-video-cancel', id: previous.id })) { previous.status = 'cancelling'; render(); }
        return;
      }
      if (info.drm || info.live || (info.youtube && !info.pageUrl && !info.ad)) return;
      const id = crypto.randomUUID(), video = active;
      const state = { ...info, id, status: 'preparing', message: 'Preparing video…' };
      states.set(video, state); pending.set(id, { video, state });
      pinned = pending.get(id);
      closeMenu(true);
      const redditManifest = redditPlayerManifest(video);
      const streams = redditManifest ? [redditManifest] : mediaStreams.hints(video, { singlePlayer: [...videos].filter((v) => v.isConnected).length === 1, boundOnly: info.ad });
      if (!post({ kind: 'auraview-video-download', id, url: info.url, pageUrl: info.pageUrl, poster: info.poster, title: info.title,
        instagramVideoId: info.playerId,
        streams, streamOnly: info.ad, duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null })) {
        state.status = 'error'; state.message = 'Unable to start download. Click to retry.'; pending.delete(id); closeMenu();
      }
      render();
    });
    button.addEventListener('focus', () => { focused = active; schedule(); });
    button.addEventListener('blur', () => { focused = undefined; schedule(); });
    observer = new MutationObserver((records) => {
      if (records.every((record) => record.target === host || host.contains(record.target))) return;
      for (const record of records) for (const node of record.addedNodes || []) track(node);
      for (const v of videos) if (!v.isConnected) { videos.delete(v); resizeObserver?.unobserve(v); }
      schedule(true);
    });
    if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(() => schedule(true));
    watchRoot(document.documentElement); track(document);
  }
  function lift() {
    try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover?.(); } catch { /* older WebView */ }
  }
  function pinnedVideo() {
    if (pinned && (!pinned.video.isConnected || target(pinned.video).key !== pinned.state.key
      || (!busy(pinned.state.status) && pinned.state.status !== 'saved'))) pinned = undefined;
    return pinned?.video;
  }
  function render() {
    if (!button) return;
    const pinnedPlayer = pinnedVideo();
    if (!active && pinnedPlayer) active = pinnedPlayer;
    if (menuRequest && (!menuRequest.video.isConnected || target(menuRequest.video).key !== menuRequest.state.key)) closeMenu(true);
    if (!active?.isConnected || leaving || document.hidden
      || (pointerIdle && active !== pinnedPlayer && !menuRequest && !button.matches(':focus-visible'))) {
      button.style.display = badge.style.display = menu.style.display = 'none'; return;
    }
    const r = playable(active);
    if (!r) { button.style.display = badge.style.display = menu.style.display = 'none'; return; }
    renderMenu(r);
    const info = target(active), stored = states.get(active), state = stored?.key === info.key ? stored : undefined;
    let title = state?.message || 'Download video';
    if (info.drm) title = 'Protected video — downloading unavailable';
    else if (info.live) title = 'Live-stream recording is not supported yet';
    else if (info.youtube && !info.pageUrl && !info.ad) title = 'Open this video’s watch page to download';
    else if (busy(state?.status)) title = `${title} — click to cancel`;
    else if (state?.status === 'error' || state?.status === 'cancelled') title += ' Click to retry.';
    button.title = title; button.setAttribute('aria-label', title);
    button.setAttribute('aria-disabled', String(info.drm || info.live || (info.youtube && !info.pageUrl && !info.ad)));
    const path = busy(state?.status) ? 'M6 6l12 12M6 18 18 6' : state?.status === 'saved' ? 'M5 12l4 4L19 6' : download;
    icon.setAttribute('d', path);
    button.style.color = state?.status === 'saved' ? '#67e8a4' : state?.status === 'error' ? '#fca5a5' : '#fff';
    button.style.left = `${r.right - 38}px`; button.style.top = `${r.top + 6}px`; button.style.display = 'block';
    badge.textContent = busy(state?.status) ? (state.percent != null ? `${Math.floor(state.percent)}%` : state.status === 'merging' ? (state.message?.includes('Converting') ? 'Converting…' : 'Merging…') : 'Preparing…') : '';
    badge.style.left = `${r.right - 72}px`; badge.style.top = `${r.top + 42}px`; badge.style.display = badge.textContent && !menuRequest ? 'block' : 'none';
  }
  function schedule(recheck = false) {
    recheckPending ||= recheck;
    if (frame || leaving) return;
    frame = requestAnimationFrame(() => { frame = 0; if (recheckPending && !focused) active = menuRequest?.video || videoAt() || pinnedVideo(); recheckPending = false; render(); });
  }
  function result(payload) {
    if (payload?.kind !== 'auraview-video-result') return;
    for (let i = 0; i < window.frames.length; i++) { try { window.frames[i].postMessage(payload, '*'); } catch { /* navigated */ } }
    const request = pending.get(payload.id);
    if (!request) return;
    Object.assign(request.state, payload);
    if (payload.status === 'preparing' && (payload.resolutions?.length > 1 || payload.audioOption)
      && (active === request.video || pinned === request) && target(request.video).key === request.state.key) {
      menuRequest = request; active = request.video;
    }
    if (menuRequest?.state === request.state && payload.status !== 'preparing') closeMenu();
    if (!busy(payload.status)) pending.delete(payload.id);
    schedule();
  }
  window.addEventListener('pointermove', (e) => {
    if (!e.isTrusted || e.pointerType === 'touch') return;
    if (x !== e.clientX || y !== e.clientY) showTemporarily();
    x = e.clientX; y = e.clientY; active = menuRequest?.video || videoAt(e) || pinnedVideo(); schedule();
  }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (!menuRequest || !e.isTrusted) return;
    const path = e.composedPath();
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(true); button.focus({ preventScroll: true }); schedule(); }
    else if (e.key === 'Tab') { closeMenu(true); schedule(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && path.includes(host)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const index = menuButtons.findIndex((b) => path.includes(b));
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? menuButtons.length - 1
        : index < 0 ? (e.key === 'ArrowUp' ? menuButtons.length - 1 : 0)
        : (index + (e.key === 'ArrowUp' ? -1 : 1) + menuButtons.length) % menuButtons.length;
      menuButtons[next]?.focus({ preventScroll: true });
    }
  }, true);
  document.addEventListener('focusin', (e) => {
    if (e.composedPath().includes(host)) return;
    focused = e.target instanceof HTMLVideoElement ? e.target : [...videos].find((v) => e.target.contains?.(v) && playable(v));
    if (focused?.matches(':focus-visible')) showTemporarily();
    active = focused || pinnedVideo(); schedule();
  });
  function hide() { if (focused && !pinnedVideo()) return; clearIdleTimer(); pointerIdle = true; active = pinnedVideo(); x = y = -1; schedule(); }
  document.addEventListener('pointerleave', hide);
  window.addEventListener('blur', () => { focused = undefined; hide(); });
  document.addEventListener('scroll', () => schedule(true), { capture: true, passive: true });
  window.addEventListener('resize', () => schedule(true));
  for (const event of ['loadedmetadata', 'playing', 'pause', 'emptied']) document.addEventListener(event, (e) => { track(e.target); schedule(true); }, true);
  document.addEventListener('encrypted', (e) => { encrypted.add(e.target); schedule(); }, true);
  document.addEventListener('fullscreenchange', () => { lift(); schedule(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { focused = undefined; hide(); } else schedule(true); });
  window.addEventListener('auraview-video-result', (e) => result({ ...e.detail, kind: 'auraview-video-result' }));
  window.addEventListener('message', (e) => { if (e.source === window.parent && window.parent !== window) result(e.data); });
  window.addEventListener('pagehide', () => { closeMenu(true); leaving = true; clearIdleTimer(); pointerIdle = true; x = y = -1; focused = undefined; cancelAnimationFrame(frame); frame = 0; pending.clear(); pinned = undefined; if (button) button.style.display = badge.style.display = 'none'; });
  window.addEventListener('pageshow', () => { leaving = false; track(document); schedule(true); });
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
})();
