import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src-tauri/src/instagram-post.js', import.meta.url), 'utf8');
const post = 'https://scontent.cdninstagram.com/selected.jpg?sig=1';
const root = { id: '1_99', carousel_media: [
  { id: '2_99', image_versions2: { candidates: [{url: post}] }, video_versions: [{url:'https://cdn.example/2.mp4',width:720,height:1280}] },
  { id: '3_99', image_versions2: { candidates: [{url:'https://scontent.cdninstagram.com/other.jpg'}] }, video_versions: [{url:'https://cdn.example/3.mp4'}] },
] };
async function resolve(data, input = {}) {
  const fn = runInNewContext(`(${source})`, { location:{hostname:'www.instagram.com'}, document:{cookie:''}, URL, AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ok:true,text:async()=>JSON.stringify(data)}) });
  return fn({shortcode:'B', poster:post, playerId:'', ...input});
}
test('carousel fallback matches the selected player and never defaults to a neighboring item', async () => {
  assert.equal((await resolve({items:[root]})).id, '2');
  assert.equal((await resolve({items:[root]}, {poster:'',playerId:'3'})).id, '3');
  assert.equal(await resolve({items:[root]}, {poster:'',playerId:''}), null);
  assert.equal(await resolve({items:[root]}, {poster:'https://scontent.cdninstagram.com/unknown.jpg'}), null);
  assert.equal(await resolve({items:[{...root,id:'9_99'}]}), null);
  assert.equal(await resolve({items:[{...root,carousel_media:[root.carousel_media[0],root.carousel_media[0]]}]}), null);
  assert.equal(await resolve({items:[{...root,carousel_media:undefined}]}), null);
});
