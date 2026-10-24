import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../src-tauri/src/instagram-story.js', import.meta.url), 'utf8');
const id = '3994261805935619921';
const video = { id: `${id}_1234`, pk: Number(id), video_versions: [{ url: 'https://cdn.example/story.mp4', width: 720, height: 1280 }],
  has_audio: true, video_duration: 15, user: { private: 'account data' } };
async function resolve(data, options = {}) {
  const calls = [], timers = [], cleared = [];
  const context = vm.createContext({ location: { hostname: options.host ?? 'www.instagram.com' }, document: { cookie: 'other=1; csrftoken=test-csrf' },
    AbortController, setTimeout(fn, ms) { timers.push({ fn, ms }); return 123; }, clearTimeout(id) { cleared.push(id); },
    async fetch(url, init) {
      calls.push({ url, init });
      if (options.throws) throw Error('connection lost');
      const body = url.includes('web_profile_info') ? { data: { user: { id: '1234' } } }
        : url.includes('reels_media') ? { reels: { '1234': { items: options.reelItems ?? [] } } } : data;
      return { ok: options.ok ?? true, text: async () => options.text ?? JSON.stringify(body) };
    } });
  context.URL = URL;
  const args = { storyId: options.id === undefined ? id : options.id, username: options.username ?? 'creator',
    poster: options.poster ?? '', mediaUrl: options.mediaUrl ?? '', playerId: options.playerId ?? '' };
  const result = await vm.runInContext(`(${script})(${JSON.stringify(args)})`, context);
  return { result: JSON.parse(JSON.stringify(result)), calls, timers, cleared };
}

test('stories use the open Instagram session and exact composite ID despite numeric pk precision loss', async () => {
  const { result, calls, timers, cleared } = await resolve({ items: [{ ...video, id: '3994261805935619922_1234' }, video] });
  assert.equal(result.id, id);
  assert.equal(result.video_versions[0].url, video.video_versions[0].url);
  assert.equal(result.has_audio, true);
  assert.equal(result.user, undefined);
  assert.equal(result.pk, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/v1/media/${id}/info/`);
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.mode, 'same-origin');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['X-CSRFToken'], 'test-csrf');
  assert.equal(timers[0].ms, 12000);
  assert.deepEqual(cleared, [123]);
});

test('stories never use a neighboring item, rounded numeric ID, image, or failed login response', async () => {
  for (const data of [{ items: [{ ...video, id: '3994261805935619922_1234' }] },
    { items: [{ ...video, id: Number(id), pk: Number(id) }] },
    { items: [{ id, image_versions2: {} }] }, { status: 'fail', message: 'login_required' }]) {
    assert.equal((await resolve(data)).result, null);
  }
  for (const options of [{ ok: false }, { throws: true }, { text: '<html>login</html>' }, { text: 'x'.repeat(2 * 1024 * 1024 + 1) }]) {
    const { result, cleared } = await resolve({ items: [video] }, options);
    assert.equal(result, null);
    assert.deepEqual(cleared, [123]);
  }
});

test('story lookup stays on Instagram and accepts only numeric selected-story IDs', async () => {
  for (const options of [{ host: 'evilinstagram.com' }, { host: 'instagram.com.evil.example' }, { id: '../private' }, { username: 'highlights' }, { username: '../x' }]) {
    const { result, calls } = await resolve({ items: [video] }, options);
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  }
});

test('Home account story URLs select only a unique exact player poster, including signed URL refreshes', async () => {
  const poster = 'https://scontent.cdninstagram.com/v/t51/selected.jpg?signature=old';
  const selected = { ...video, image_versions2: { candidates: [{ url: poster.replace('old', 'new') }] } };
  const neighbor = { ...video, id: '3994261805935619922_1234', image_versions2: { candidates: [{ url: poster.replace('selected', 'neighbor') }] } };
  const { result, calls } = await resolve({}, { id: null, poster, reelItems: [neighbor, selected] });
  assert.equal(result.id, id);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/v1/users/web_profile_info/?username=creator');
  assert.equal(calls[1].url, '/api/v1/feed/reels_media/?reel_ids=1234');
  assert.equal((await resolve({}, { id: null, poster, reelItems: [neighbor] })).result, null);
  assert.equal((await resolve({}, { id: null, poster, reelItems: [selected, { ...selected, id: neighbor.id }] })).result, null);
  assert.equal((await resolve({}, { id: null, poster: 'https://evil.example/selected.jpg', reelItems: [selected] })).calls.length, 0);
  assert.equal((await resolve({}, { id: null, reelItems: [selected] })).calls.length, 0);
});

test('exact-ID lookup can fall back to session reels but never a different video with a matching poster', async () => {
  const { result } = await resolve({ items: [] }, { reelItems: [video] });
  assert.equal(result.id, id);
  assert.equal((await resolve({ items: [] }, { reelItems: [{ ...video, id: '3994261805935619922_1234' }] })).result, null);
});

test('posterless Home stories resolve the selected player ID through authenticated media info', async () => {
  const selected = { ...video, user: { username: 'creator' } };
  const { result, calls } = await resolve({ items: [selected] }, { id: null, playerId: id });
  assert.equal(result.id, id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/v1/media/${id}/info/`);
  assert.equal((await resolve({ items: [{ ...selected, user: { username: 'neighbor' } }] }, { id: null, playerId: id })).result?.id, undefined);
  assert.equal((await resolve({ items: [] }, { id: null, playerId: '55555', reelItems: [{ ...selected, video_id: '55555' }] })).result.id, id);
});
