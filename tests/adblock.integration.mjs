// Explicit desktop integration check; not part of the browserless *.test.mjs suite.
// Run after building the debug app, with Vite running on localhost:1420.
// Uses a separate WebView2 profile and restores the saved adblocking preference.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve('tests/.adblock-check.local');
await mkdir(root, { recursive: true });
const keyPath = resolve(root,'fixture-key.pem'), certPath = resolve(root,'fixture-cert.pem');
execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=AuraView local test'],{stdio:'ignore',windowsHide:true});
const cert = await readFile(certPath), key = await readFile(keyPath);
const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
const youtubeData = {videoDetails:{videoId:'ordinary'},streamingData:{formats:[{url:'https://media.example/content'}]},playerAds:[{ad:1}],adPlacements:[{ad:1}],adSlots:[{ad:1}]};
const instagramData = {data:{feed:{edges:[{node:{id:'organic',caption:'Sponsored word in a caption'}},{node:{id:'paid',ad_id:'123'}},{node:{id:'partnership',is_paid_partnership:true}}]}}};
const siteServer = createHttpsServer({key,cert},(req,res) => {
  res.setHeader('Cache-Control','private,max-age=3600');
  res.setHeader('Set-Cookie','av_fixture=works; SameSite=Lax; Secure; Path=/');
  if(req.url.startsWith('/youtubei/v1/')) {
    if(req.url.endsWith('/broken')) {res.end('not JSON');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(youtubeData));return;
  }
  if(req.url.startsWith('/graphql/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(instagramData));return;}
  res.setHeader('Content-Type','text/html');
  if(req.headers.host.startsWith('www.youtube.com')) {
    res.end(`<!doctype html><html><body><h1>YouTube response fixture</h1><script>var ytInitialPlayerResponse=${JSON.stringify(youtubeData)};window.comparison=1<2;
      window.fetched=fetch('/youtubei/v1/player',{method:'POST',body:'{}'}).then(r=>{window.fetchCache=r.headers.get('cache-control');return r.json()});
      window.xhrData=new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST','/youtubei/v1/player');x.responseType='json';x.onload=()=>resolve(x.response);x.send('{}')});
      window.broken=fetch('/youtubei/v1/broken').then(r=>r.text());
      </script></body></html>`);return;
  }
  res.end(`<!doctype html><html><body><h1>Instagram response fixture</h1><script type="application/json" id="initial">${JSON.stringify(instagramData)}</script>
    <script>window.initial=JSON.parse(document.getElementById('initial').textContent);window.fetched=fetch('/graphql/query').then(r=>r.json());
    setTimeout(()=>{const sponsor=document.createElement('article');sponsor.id='sponsor';sponsor.innerHTML='<header><span>Sponsored</span></header><p>Advertisement</p>';document.body.appendChild(sponsor);
    const ordinary=document.createElement('article');ordinary.id='ordinary';ordinary.innerHTML='<header><span>A friend</span></header><p>Sponsored word in an ordinary caption</p>';document.body.appendChild(ordinary);
    const username=document.createElement('article');username.id='username';username.innerHTML='<header><a href="/sponsored/"><span>Sponsored</span></a></header><p>Ordinary author name</p>';document.body.appendChild(username);},100);</script></body></html>`);
});
await new Promise(r=>siteServer.listen(0,'127.0.0.1',r));
const sitePort=siteServer.address().port;
const requests = [];
const server = createServer((req, res) => {
  requests.push({ host: req.headers.host, path: req.url });
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/pagead/')) { res.setHeader('Content-Type', 'application/javascript'); res.end('window.adLoaded = true'); return; }
  if (req.url === '/normal.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('window.normalLoaded = true'); return; }
  res.setHeader('Content-Type', 'text/html');
  // Constructed cosmetic stylesheets should work even under a restrictive style CSP.
  res.setHeader('Content-Security-Policy', "style-src 'none'; script-src 'unsafe-inline' http:");
  const port = server.address().port;
  const frame = req.url.startsWith('/frame');
  const nested = req.url === '/frame-nested';
  res.end(`<!doctype html><html><head><title>AuraView adblock integration</title></head><body>
    <h1>Ad blocking test</h1><p id="content">Ordinary content stays visible.</p>
    <div class="ADBAR" id="ad">Synthetic advertisement</div>
    <script src="/normal.js"></script>
    <script src="http://pagead2.googlesyndication.com:${port}/pagead/js/adsbygoogle.js?frame=${nested ? 'nested' : frame ? 'frame' : 'top'}"></script>
    ${!frame ? `<iframe src="http://example.org:${port}/frame"></iframe>` : !nested ? `<iframe src="http://example.net:${port}/frame-nested"></iframe>` : ''}
    <script>
      window.frameReports = {};
      addEventListener('message', event => { if(event.data?.testFrame) frameReports[event.data.testFrame] = event.data; });
      setTimeout(() => { const ad = document.createElement('div'); ad.className='ADFooter'; ad.id='dynamic'; ad.textContent='Dynamic advertisement'; document.body.appendChild(ad); }, 250);
      ${frame ? `setInterval(() => top.postMessage({testFrame:${JSON.stringify(nested ? 'nested' : 'frame')}, hidden:getComputedStyle(document.getElementById('ad')).display==='none', dynamicHidden:document.getElementById('dynamic') && getComputedStyle(document.getElementById('dynamic')).display==='none', normal:!!normalLoaded, adLoaded:!!window.adLoaded}, '*'), 200);` : ''}
    </script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const debugPort = probe.address().port; await new Promise(r => probe.close(r));
const binary = resolve(root, 'auraview-adblock-check.exe');
await copyFile(resolve('src-tauri/target/debug/auraview.exe'), binary);
const child = spawn(binary, [], { cwd: resolve('.'), windowsHide: true, env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: resolve(root, `profile-${Date.now()}`),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --ignore-certificate-errors-spki-list=${spki} --host-resolver-rules="MAP example.com 127.0.0.1, MAP example.org 127.0.0.1, MAP example.net 127.0.0.1, MAP pagead2.googlesyndication.com 127.0.0.1, MAP www.youtube.com 127.0.0.1, MAP www.instagram.com 127.0.0.1"`,
} });
let output = ''; child.stderr.on('data', d => { output += d; });
const connections = [];
async function until(fn, description, timeout = 20000) {
  const deadline = Date.now() + timeout; let last;
  do { try { const result = await fn(); if (result) return result; } catch (e) { last = e; } await delay(100); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}. ${last || ''}\n${output}`);
}
async function targets() { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); }
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
  await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
  ws.onmessage = ({ data }) => { const msg = JSON.parse(data); if (!msg.id) return; const next = pending.get(msg.id); if (next) { pending.delete(msg.id); msg.error ? next.reject(new Error(JSON.stringify(msg.error))) : next.resolve(msg.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Protocol timeout: ${method} on ${target.url}`)); }, 8000);
    pending.set(key, {resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});
    ws.send(JSON.stringify({id:key,method,params}));
  });
  connections.push(ws);
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  return { call, evaluate };
}
let main, original, browser;
try {
  const list = await until(async () => { const list = await targets(); return list.some(t => t.url === 'http://localhost:1420/') && list; }, 'test app inspector');
  main = await connect(list.find(t => t.url === 'http://localhost:1420/'));
  await until(() => main.evaluate(`typeof window.__TAURI_INTERNALS__?.invoke === 'function'`), 'native app bridge');
  const invoke = (command, args = {}) => main.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
  original = await invoke('get_browser_settings');
  console.log('Native settings loaded', original);
  await invoke('set_adblock_enabled', {enabled:true});
  const browserTarget = await until(async () => (await targets()).find(t => t.id !== list.find(t => t.url === 'http://localhost:1420/').id && ['page','webview'].includes(t.type)), 'browser page target');
  browser = await connect(browserTarget);
  // Use AuraView's navigation command so React and the native view agree on the URL.
  const page = `http://example.com:${port}/`;
  await until(async()=>{await invoke('navigate_browser_view', {url:page, tabId:'tab-1', pane:'primary'});return true;},'initial browser registration');
  console.log('Fixture navigation started');
  const state = () => browser.evaluate(`({normal:!!window.normalLoaded,adLoaded:!!window.adLoaded,hidden:!!document.getElementById('ad')&&getComputedStyle(document.getElementById('ad')).display==='none',dynamicHidden:!!document.getElementById('dynamic')&&getComputedStyle(document.getElementById('dynamic')).display==='none',content:!!document.getElementById('content')&&getComputedStyle(document.getElementById('content')).display!=='none',frames:window.frameReports})`);
  const on = await until(async () => { const value = await state(); return value.hidden && value.dynamicHidden && value.frames?.frame?.hidden && value.frames?.nested?.hidden && value; }, 'top, dynamic and nested-frame cosmetic hiding');
  assert.equal(on.normal, true); assert.equal(on.content, true); assert.equal(on.adLoaded, false);
  assert.equal(on.frames.frame.adLoaded, false);
  assert.equal(requests.filter(r => r.path.startsWith('/pagead/') && !r.path.endsWith('frame=nested')).length, 0, 'blocked top-level and first-frame requests must never reach the server');
  // WebView2 issue #5765: deeply nested cross-origin requests may bypass its
  // native request event. Keep the observable result in the report; CSS hiding
  // is still required in nested frames. Do not claim that gap is covered.
  await invoke('set_adblock_enabled', {enabled:false});
  await until(async () => { const value=await state(); return !value.hidden && !value.dynamicHidden && value.frames?.frame?.hidden===false && value.frames?.nested?.hidden===false; }, 'cosmetic removal without navigating');
  await browser.call('Page.reload', {ignoreCache:true});
  const off = await until(async () => { const value=await state(); return value.adLoaded && value.frames?.nested?.adLoaded && value; }, 'unblocked requests after disabling');
  assert.equal(off.hidden, false); assert.ok(requests.some(r => r.path.startsWith('/pagead/')));
  await invoke('set_adblock_enabled', {enabled:true});
  await until(async () => { const value=await state(); return value.hidden && value.frames?.nested?.hidden; }, 're-enable cosmetic hiding without navigating');
  await invoke('navigate_browser_view', {url:`http://localhost:${port}/`, tabId:'tab-1', pane:'primary'});
  const local = await until(async () => { const value=await state(); return value.adLoaded && value.frames?.nested?.adLoaded && value.frames?.frame?.hidden===false && value.frames?.nested?.hidden===false && value; }, 'localhost exemption');
  assert.equal(local.hidden, false); assert.equal(local.dynamicHidden, false);
  await invoke('navigate_browser_view',{url:`https://www.youtube.com:${sitePort}/watch?v=ordinary`,tabId:'tab-1',pane:'primary'});
  const youtube = await until(async()=>browser.evaluate(`Promise.all([window.fetched,window.xhrData,window.broken]).then(([fetchData,xhrData,broken])=>window.ytInitialPlayerResponse && fetchData && xhrData && ({initial:window.ytInitialPlayerResponse,fetchData,xhrData,broken,comparison:window.comparison}))`),'native YouTube response filtering');
  assert.equal(youtube.initial.videoDetails.videoId,'ordinary'); assert.equal(youtube.comparison,true);
  for(const data of [youtube.initial,youtube.fetchData,youtube.xhrData]) {assert.equal(data.playerAds,undefined);assert.equal(data.adPlacements,undefined);assert.equal(data.adSlots,undefined);assert.equal(data.streamingData.formats[0].url,'https://media.example/content');}
  assert.equal(youtube.broken,'not JSON');
  assert.equal(await browser.evaluate(`window.fetchCache`),'no-store');
  assert.equal(await browser.evaluate(`document.cookie.includes('av_fixture=works')`),true);
  await invoke('set_adblock_enabled',{enabled:false});
  await invoke('reload_browser_view',{tabId:'tab-1',pane:'primary'});
  await until(()=>browser.evaluate(`!!window.ytInitialPlayerResponse?.playerAds?.length`),'unmodified YouTube data when disabled');
  await invoke('set_adblock_enabled',{enabled:true});
  await invoke('reload_browser_view',{tabId:'tab-1',pane:'primary'});
  await until(()=>browser.evaluate(`!!window.ytInitialPlayerResponse?.videoDetails && !window.ytInitialPlayerResponse.playerAds`),'cached YouTube response filtering after re-enabling');
  await invoke('navigate_browser_view',{url:`https://www.instagram.com:${sitePort}/`,tabId:'tab-1',pane:'primary'});
  const instagram=await until(async()=>browser.evaluate(`Promise.resolve(window.fetched).then(data=>window.initial && data && document.getElementById('sponsor') && ({initial:window.initial,fetched:data,sponsorHidden:getComputedStyle(document.getElementById('sponsor')).display==='none',ordinaryVisible:getComputedStyle(document.getElementById('ordinary')).display!=='none'}))`),'Instagram feed and sponsored post filtering');
  for(const data of [instagram.initial,instagram.fetched]) assert.deepEqual(data.data.feed.edges.map(edge=>edge.node.id),['organic','partnership']);
  await until(()=>browser.evaluate(`getComputedStyle(document.getElementById('sponsor')).display==='none'`),'Instagram sponsored label DOM fallback');
  instagram.sponsorHidden = true;
  assert.equal(instagram.ordinaryVisible,true);
  assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById('username')).display!=='none'`),true);
  await browser.evaluate(`document.querySelector('#sponsor header span').textContent='A friend'`);
  await until(()=>browser.evaluate(`getComputedStyle(document.getElementById('sponsor')).display!=='none'`),'recycled Instagram post becomes visible');
  const existingTargets = new Set((await targets()).map(target=>target.id));
  await main.evaluate(`document.querySelector('button[title^="Split view"]').click()`);
  const secondaryTarget = await until(async () => (await targets()).find(t => !existingTargets.has(t.id) && ['page','webview'].includes(t.type)), 'second split view');
  const secondary = await connect(secondaryTarget);
  const splitPageId = await main.evaluate(`Array.from(document.querySelectorAll('[data-tab-page]'),node=>node.dataset.tabPage).find(id=>id!=='tab-1')`);
  await until(async () => { await invoke('navigate_browser_view', {url:page,tabId:splitPageId,pane:'primary'}); return true; }, 'second pane registration');
  const split = await until(() => secondary.evaluate(`document.getElementById('ad') && getComputedStyle(document.getElementById('ad')).display==='none' && !!window.normalLoaded && !window.adLoaded`), 'ad blocking in a newly created split pane');
  assert.equal(split,true);
  await invoke('toggle_browser_settings', {anchor:{x:1200,y:45,width:25,height:25}});
  const menuTarget = await until(async () => (await targets()).find(t => t.url.includes('#browser-settings')), 'Settings menu');
  const menu = await connect(menuTarget);
  await until(() => menu.evaluate(`(()=>{const toggle=document.querySelector('[aria-label="Ad blocking"]');return toggle && !toggle.disabled && toggle.getAttribute('aria-checked')==='true'})()`), 'enabled Settings switch');
  const screenshot = await menu.call('Page.captureScreenshot', {format:'png'});
  await writeFile(resolve(root, 'settings.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({on,split,off,local,youtube,instagram,screenshot:resolve(root,'settings.png'),nativeErrors:output},null,2));
} catch (error) {
  if (browser) console.error(await browser.evaluate(`JSON.stringify({url:location.href,title:document.title,text:document.body?.innerText,frames:window.frameReports,sheets:document.adoptedStyleSheets?.map(s=>({disabled:s.disabled,rules:s.cssRules.length}))})`).catch(String));
  console.error(JSON.stringify(requests));
  throw error;
} finally {
  if (main && original) {
    try { await main.evaluate(`window.__TAURI_INTERNALS__.invoke('set_adblock_enabled',{enabled:${original.adblockEnabled}})`); } catch { /* Reported by app stderr if it already exited. */ }
  }
  await Promise.all(connections.map(ws => new Promise(resolve => { if (ws.readyState === WebSocket.CLOSED) return resolve(); ws.addEventListener('close', resolve, {once:true}); ws.close(); })));
  child.kill(); server.close(); server.closeAllConnections();
  siteServer.close();siteServer.closeAllConnections();
}
