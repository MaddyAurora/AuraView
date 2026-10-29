async function ({ shortcode, poster, playerId }) {
  if (!/^(www\.)?instagram\.com$/.test(location.hostname) || !/^[A-Za-z0-9_-]{1,20}$/.test(shortcode)) return null;
  if (!poster && !playerId) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let mediaId = 0n;
  for (const char of shortcode) mediaId = mediaId * 64n + BigInt(alphabet.indexOf(char));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
    const csrf = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('csrftoken='));
    if (csrf) headers['X-CSRFToken'] = csrf.slice('csrftoken='.length);
    const response = await fetch(`/api/v1/media/${mediaId}/info/`, { credentials: 'include', mode: 'same-origin', redirect: 'error', headers, signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) return null;
    const items = JSON.parse(text)?.items;
    if (!Array.isArray(items) || items.length !== 1) return null;
    const root = items[0];
    const idOf = item => [item.id, item.pk].find(id => typeof id === 'string' && /^\d+(?:_\d+)?$/.test(id))?.split('_')[0];
    if (idOf(root) !== String(mediaId)) return null;
    const asset = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname) ? `${u.hostname}${u.pathname}` : ''; } catch { return ''; } };
    const posterAsset = asset(poster), player = /^\d+$/.test(playerId) ? playerId : '';
    if (!posterAsset && !player) return null;
    if (!Array.isArray(root.carousel_media)) return null;
    const candidates = root.carousel_media;
    const matches = candidates.filter(item => Array.isArray(item.video_versions) &&
      ((player && [idOf(item), item.video_id, item.fb_video_id].some(id => (typeof id === 'string' || Number.isSafeInteger(id)) && String(id) === player)) ||
       (posterAsset && item.image_versions2?.candidates?.some(image => asset(image.url) === posterAsset))));
    if (matches.length !== 1) return null;
    const item = matches[0], id = idOf(item);
    if (!id) return null;
    return { id, video_versions: item.video_versions.map(v => ({ url: v.url, width: v.width, height: v.height })), has_audio: item.has_audio, video_duration: item.video_duration };
  } catch { return null; } finally { clearTimeout(timer); }
}
