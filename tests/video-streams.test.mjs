import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src-tauri/src/video-streams.js', import.meta.url), 'utf8');
function page() {
  const entries = []; let nextBlob = 0, observe;
  class PageURL extends URL {
    static createObjectURL() { return `blob:https://example.com/stream-${++nextBlob}`; }
    static revokeObjectURL() {}
  }
  class SourceBuffer { appendBuffer(data) { if (this.fail) throw Error('original append error'); this.last = data; } }
  class MediaSource {
    constructor() { this.sourceBuffers = []; }
    addSourceBuffer() { const buffer = new SourceBuffer(); this.sourceBuffers.push(buffer); return buffer; }
  }
  class Response {
    constructor(url, data, mime = 'video/mp4') { this.url = url; this.data = data; this.headers = { get: () => mime }; }
    arrayBuffer() { return Promise.resolve(this.data); }
    text() { return Promise.resolve(this.data); }
  }
  class PerformanceObserver { constructor(fn) { observe = fn; } observe() {} }
  const context = { URL: PageURL, location: new URL('https://example.com/feed'), MediaSource, SourceBuffer, Response,
    PerformanceObserver, performance: { getEntriesByType: () => entries }, ArrayBuffer, Uint8Array };
  const api = vm.runInNewContext(source, context);
  return { api, URL: PageURL, MediaSource, Response,
    entries,
    resource(url) { entries.push({ name: url }); observe({ getEntries: () => [{ name: url }] }); },
    player() { const media = new MediaSource(); return { media, video: { currentSrc: PageURL.createObjectURL(media) } }; },
    async append(media, url, mime, data = new Uint8Array([1, 2, 3, 4]).buffer) {
      const response = new Response(url, data, mime), original = await response.arrayBuffer();
      assert.equal(original, data, 'observation must preserve the response object');
      const buffer = media.addSourceBuffer(mime); buffer.appendBuffer(original); return buffer;
    },
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a selected MediaSource retains its own video and audio URLs across multiple feed players', async () => {
  const h = page(), first = h.player(), second = h.player();
  await h.append(first.media, 'https://cdn.example/first.mp4', 'video/mp4; codecs="avc1.640015"');
  await h.append(first.media, 'https://cdn.example/first.m4a', 'audio/mp4; codecs="mp4a.40.2"');
  await h.append(second.media, 'https://cdn.example/second.mp4', 'video/mp4; codecs="avc1.640015"');
  assert.deepEqual(plain(h.api.hints(first.video, { boundOnly: true })).map(hint => [hint.url, hint.kind]), [
    ['https://cdn.example/first.mp4', 'video'], ['https://cdn.example/first.m4a', 'audio'],
  ]);
  assert.equal(h.api.hints(second.video, { boundOnly: true })[0].url, 'https://cdn.example/second.mp4');
  second.media.sourceBuffers[0].appendBuffer(new Uint8Array([9, 8, 7]).buffer);
  assert.equal(h.api.hints(second.video, { boundOnly: true }).length, 0, 'a reused player must discard stale attribution after an unknown append');
});
test('HLS media appended to the selected player resolves to its observed master playlist', async () => {
  const h = page(), p = h.player();
  await new h.Response('https://cdn.example/clip/master.m3u8', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvideo.m3u8', 'application/vnd.apple.mpegurl').text();
  await new h.Response('https://cdn.example/clip/video.m3u8', '#EXTM3U\nsegment0.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl').text();
  await h.append(p.media, 'https://cdn.example/clip/segment0.ts', 'video/mp2t');
  assert.deepEqual(plain(h.api.hints(p.video, { boundOnly: true })), [{ url: 'https://cdn.example/clip/master.m3u8', kind: 'manifest', mime: 'application/vnd.apple.mpegurl' }]);
});
test('unbound advertisements and ambiguous pages never borrow the main or neighboring video', () => {
  const h = page(), p = h.player();
  h.resource('https://cdn.example/main/master.m3u8');
  assert.equal(h.api.hints(p.video, { singlePlayer: true, boundOnly: true }).length, 0);
  h.resource('https://cdn.example/other/master.m3u8');
  assert.equal(h.api.hints(p.video, { singlePlayer: true }).length, 0);
  assert.equal(h.api.hints(p.video, { singlePlayer: false }).length, 0);
});
test('a single-player page can use its sole observed manifest without a supported webpage extractor', () => {
  const h = page(), p = h.player(); h.resource('https://cdn.example/only/master.m3u8');
  assert.equal(h.api.hints(p.video, { singlePlayer: true })[0].url, 'https://cdn.example/only/master.m3u8');
});
test('X poster identities select the matching stream from a timeline with several loaded videos', () => {
  const h = page(), p = h.player(); p.video.poster = 'https://pbs.twimg.com/amplify_video_thumb/123456/img/photo.jpg';
  h.resource('https://video.twimg.com/amplify_video/999999/pl/master.m3u8');
  h.resource('https://video.twimg.com/amplify_video/123456/pl/master.m3u8');
  assert.equal(h.api.hints(p.video)[0].url, 'https://video.twimg.com/amplify_video/123456/pl/master.m3u8');
});
test('missing audio bindings and identical transferred initialization buffers stay ambiguous', async () => {
  const h = page(), p = h.player();
  const buffer = await h.append(p.media, 'https://cdn.example/one.mp4', 'video/mp4');
  p.media.addSourceBuffer('audio/mp4');
  assert.equal(h.api.hints(p.video, { boundOnly: true }).length, 0, 'do not silently drop a missing audio track');
  const other = h.player();
  await new h.Response('https://cdn.example/two.mp4', new Uint8Array([1, 2, 3, 4]).buffer).arrayBuffer();
  const transferred = new Uint8Array([1, 2, 3, 4]).buffer;
  other.media.addSourceBuffer('video/mp4').appendBuffer(transferred);
  assert.equal(h.api.hints(other.video, { boundOnly: true }).length, 0, 'identical bytes from two origins cannot identify a URL');
  buffer.fail = true; assert.throws(() => buffer.appendBuffer(transferred), /original append error/);
});
