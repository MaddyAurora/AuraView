// Runs in the selected frame's isolated world, using its existing login.
async function ({ storyId, username, poster, mediaUrl, playerId }) {
  if (!/^(www\.)?instagram\.com$/.test(location.hostname) || !/^[A-Za-z0-9_.]+$/.test(username)
    || username.toLowerCase() === 'highlights' || (storyId && !/^\d+$/.test(storyId))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
    const csrf = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('csrftoken='));
    if (csrf) headers['X-CSRFToken'] = csrf.slice('csrftoken='.length);
    async function get(path) {
      const response = await fetch(path, {
        credentials: 'include', mode: 'same-origin', redirect: 'error', headers, signal: controller.signal,
      });
      if (!response.ok) return null;
      const text = await response.text();
      return text.length <= 2 * 1024 * 1024 ? JSON.parse(text) : null;
    }
    // Instagram IDs exceed JavaScript's integer precision. Only compare exact
    // string IDs (the composite id is also provided when pk is a JSON number).
    const idOf = item => [item.id, item.pk].find(id => typeof id === 'string' && /^\d+(?:_\d+)?$/.test(id))?.split('_')[0];
    const player = typeof playerId === 'string' && /^\d+$/.test(playerId) ? playerId : '';
    const matchesPlayer = item => player && [idOf(item), item.video_id, item.fb_video_id].some(id =>
      (typeof id === 'string' || Number.isSafeInteger(id)) && String(id) === player);
    let item;
    if (storyId || player) {
      const data = await get(`/api/v1/media/${storyId || player}/info/`);
      const matches = data?.items?.filter(item => storyId ? idOf(item) === storyId :
        matchesPlayer(item) && item.user?.username?.toLowerCase() === username.toLowerCase());
      if (matches?.length === 1) item = matches[0];
    }
    if (!item) {
      // Home sometimes opens /stories/<account>/ without an item ID. Match
      // media belonging to this player, never the first/newest story in a reel.
      const asset = value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
            ? `${url.hostname}${url.pathname}` : '';
        } catch { return ''; }
      };
      const posterAsset = asset(poster), videoAsset = asset(mediaUrl);
      if (!storyId && !posterAsset && !videoAsset && !player) return null;
      const profile = await get(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
      const userId = profile?.data?.user?.id;
      if (typeof userId !== 'string' || !/^\d+$/.test(userId)) return null;
      const data = await get(`/api/v1/feed/reels_media/?reel_ids=${userId}`);
      const items = data?.reels?.[userId]?.items;
      if (!Array.isArray(items)) return null;
      const matches = items.filter(item => storyId ? idOf(item) === storyId :
        (posterAsset && item.image_versions2?.candidates?.some(image => asset(image.url) === posterAsset))
        || (videoAsset && item.video_versions?.some(video => asset(video.url) === videoAsset))
        || matchesPlayer(item));
      if (matches.length !== 1) return null;
      item = matches[0];
    }
    if (!item || !Array.isArray(item.video_versions)) return null;
    // Return only download metadata; account data and cookies stay in the page.
    const id = idOf(item);
    if (!id) return null;
    return { id, video_versions: item.video_versions.map(v => ({ url: v.url, width: v.width, height: v.height })),
      has_audio: item.has_audio, video_duration: item.video_duration };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
