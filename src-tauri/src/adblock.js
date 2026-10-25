(() => {
  const token = __AURAVIEW_ADBLOCK_TOKEN__;
  const bridge = window.chrome?.webview;
  if (!bridge || !/^https?:$/.test(location.protocol)) return;
  const send = bridge.postMessage.bind(bridge);
  const stringify = JSON.stringify.bind(JSON);
  const instagram = /(^|\.)instagram\.com$/i.test(location.hostname || '');
  const youtube = /(^|\.)youtube(?:-nocookie)?\.com$/i.test(location.hostname || '');
  const sponsoredLabels = new Set(['sponsored', 'sponsorizat', 'promovat', 'реклама', 'рекламная публикация', 'sponsorisé', 'gesponsert', 'publicidad', 'patrocinado']);
  const hiddenPosts = new Set();
  let siteTimer, active = false;
  const classes = new Set(), ids = new Set(), seenClasses = new Set(), seenIds = new Set(), applied = new Set();
  let sheet, style, timer, stopped = false, refreshing = false;
  function updateSiteDom() {
    clearTimeout(siteTimer); siteTimer = undefined;
    if (!active) {
      for (const article of hiddenPosts) article.removeAttribute('data-auraview-sponsored');
      hiddenPosts.clear();
      return;
    }
    if (instagram) {
      for (const article of document.querySelectorAll('article')) {
        const explicit = article.querySelector('a[href*="/ads/about/"],a[href*="/about-this-ad"],[data-testid="sponsored-label"]');
        const header = article.querySelector('header');
        const labelled = header && Array.from(header.querySelectorAll('span')).some(node => !node.closest('a[href]') && sponsoredLabels.has(node.textContent.trim().toLocaleLowerCase()));
        if (explicit || labelled) {
          article.setAttribute('data-auraview-sponsored', 'true'); hiddenPosts.add(article);
        } else if (hiddenPosts.delete(article)) article.removeAttribute('data-auraview-sponsored');
      }
      for (const article of hiddenPosts) if (!article.isConnected) { article.removeAttribute('data-auraview-sponsored'); hiddenPosts.delete(article); }
    }
    if (youtube) {
      const player = document.querySelector('#movie_player.ad-showing');
      if (!player) return;
      const skip = player.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');
      if (skip && skip.getClientRects().length && !skip.disabled) skip.click();
      // Only poll while the player explicitly reports an ad. Never seek or
      // change volume/rate on the user's actual video.
      siteTimer = setTimeout(updateSiteDom, 300);
    }
  }
  function remember(value, pending, seen) {
    if (value && value.length <= 512 && seen.size < 20000 && !seen.has(value)) { seen.add(value); pending.add(value); }
  }
  function scan(root) {
    if (stopped || !root) return;
    const visit = (element) => {
      if (element.nodeType !== 1) return;
      remember(element.id, ids, seenIds);
      for (const name of element.classList || []) remember(name, classes, seenClasses);
    };
    visit(root);
    for (const element of root.querySelectorAll?.('[class],[id]') || []) visit(element);
    schedule();
  }
  function schedule() { if (!stopped && !timer) timer = setTimeout(flush, 100); }
  function flush() {
    timer = undefined;
    if (stopped) return;
    if (refreshing) {
      refreshing = false;
      classes.clear(); ids.clear(); seenClasses.clear(); seenIds.clear();
      observe();
      scan(document.documentElement);
    }
    const batch = (pending) => { const result = Array.from(pending).slice(0, 128); result.forEach(value => pending.delete(value)); return result; };
    send(stringify({ kind: 'auraview-adblock-query', token, classes: batch(classes), ids: batch(ids) }));
    if (classes.size || ids.size) schedule();
  }
  function ensureSheet() {
    if (sheet) return true;
    if (!document.documentElement) return false;
    try {
      sheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      style = document.createElement('style');
      document.documentElement.appendChild(style);
      sheet = style.sheet;
    }
    return !!sheet;
  }
  function refresh() {
    stopped = false; refreshing = true; schedule();
    // A refresh only asks native code for the current setting; page messages
    // cannot enable protection or choose their own filtering rules.
    for (let i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage('auraview-adblock-refresh', '*'); } catch { /* Detached frame. */ }
    }
  }
  window.addEventListener('message', (event) => { if (event.data === 'auraview-adblock-refresh') refresh(); });
  bridge.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.kind === 'auraview-adblock-refresh') { refresh(); return; }
    if (!data || data.kind !== 'auraview-adblock-rules' || data.token !== token || data.url !== location.href) return;
    if (!data.enabled) {
      active = false; updateSiteDom();
      stopped = true; clearTimeout(timer); timer = undefined; observer.disconnect();
      if (sheet) sheet.disabled = true;
      return;
    }
    if (!ensureSheet()) { schedule(); return; }
    active = true; updateSiteDom();
    sheet.disabled = false;
    for (const selector of data.selectors || []) {
      if (typeof selector !== 'string' || applied.has(selector)) continue;
      try { sheet.insertRule(`${selector}{display:none!important}`, sheet.cssRules.length); applied.add(selector); } catch { /* Unsupported selectors do not affect the rest. */ }
    }
  });
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') scan(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
  });
  function observe() {
    observer.observe(document, { subtree: true, childList: true, characterData: instagram, attributes: true, attributeFilter: instagram ? ['class', 'id', 'href', 'aria-label', 'data-testid'] : ['class', 'id'] });
  }
  observe();
  document.addEventListener('DOMContentLoaded', () => scan(document.documentElement), { once: true });
  scan(document.documentElement);
  schedule();
})();
