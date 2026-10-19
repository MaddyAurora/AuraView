import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../src-tauri/src/offline-retry.js', import.meta.url), 'utf8');

function createPage(nativeResult = () => false) {
  const timers = new Map();
  const listeners = new Map();
  const requests = [];
  const navigations = [];
  const status = { innerText: '' };
  let timerId = 0;
  let now = 0;
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: () => status },
    window: {
      location: {
        assign: (url) => {
          requests.push(url);
          const result = nativeResult();
          if (result !== undefined) {
            Promise.resolve(result).then((online) => context.window.onNativeRetryResult(online));
          }
        },
        replace: (url) => navigations.push(url),
      },
      addEventListener: (event, callback) => listeners.set(event, callback),
    },
    fetch: () => { assert.fail('The offline document must never fetch the AI server'); },
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay, due: now + delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(script, context);
  return {
    requests, navigations, status,
    delays: () => [...timers.values()].map(({ delay }) => delay),
    elapse: (milliseconds) => { now += milliseconds; },
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a timer for ${delay}ms`);
      timers.delete(entry[0]);
      now = Math.max(now, entry[1].due);
      return entry[1].callback();
    },
    retry: () => context.retryNow(),
    leave: () => listeners.get('pagehide')(),
  };
}

test('offline checks wait ten seconds and failures restart the retry and countdown', async () => {
  const page = createPage();
  assert.equal(page.requests.length, 0);
  assert.deepEqual(page.delays(), [10000, 1000]);
  await page.fire(10000);
  assert.equal(page.requests.length, 1);
  assert.deepEqual(page.delays(), [10000, 1000]);
  assert.match(page.status.innerText, /offline.*10 seconds/);
  await page.fire(10000);
  assert.equal(page.requests.length, 2);
  assert.deepEqual(page.delays(), [10000, 1000]);
  assert.deepEqual(page.navigations, []);
});

test('the message counts down each second before checking and resetting after failure', async () => {
  const page = createPage();
  assert.match(page.status.innerText, /in 10 seconds/);
  for (let seconds = 9; seconds >= 1; seconds--) {
    page.fire(1000);
    assert.equal(page.status.innerText,
      `Server offline. Checking again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}...`);
    assert.equal(page.requests.length, 0);
  }
  const attempt = page.fire(10000);
  assert.equal(page.status.innerText, 'Checking server...');
  await attempt;
  assert.match(page.status.innerText, /in 10 seconds/);
  assert.equal(page.requests.length, 1);
  assert.deepEqual(page.delays(), [10000, 1000]);
});

test('delayed countdown updates use elapsed time instead of extending the retry wait', async () => {
  const page = createPage();
  page.elapse(6500);
  page.fire(1000);
  assert.match(page.status.innerText, /in 4 seconds/);
  await page.fire(10000);
  assert.equal(page.requests.length, 1);
  assert.match(page.status.innerText, /in 10 seconds/);
});

test('manual retries run immediately and restart the ten-second wait after failure', async () => {
  const page = createPage();
  page.fire(1000);
  assert.match(page.status.innerText, /in 9 seconds/);
  await page.retry();
  assert.equal(page.requests.length, 1);
  assert.match(page.status.innerText, /in 10 seconds/);
  assert.deepEqual(page.delays(), [10000, 1000]);
});

test('missing native responses time out without allowing overlapping checks', async () => {
  const page = createPage(() => undefined);
  page.fire(10000);
  assert.match(page.status.innerText, /Checking/);
  await page.retry();
  await page.retry();
  assert.equal(page.requests.length, 1);
  assert.deepEqual(page.delays(), [2000]);
  page.fire(2000);
  assert.deepEqual(page.delays(), [10000, 1000]);
});

test('an online native response stops polling without a cross-site page redirect', async () => {
  let online = false;
  const page = createPage(() => online);
  await page.fire(10000);
  online = true;
  await page.fire(10000);
  assert.equal(page.status.innerText, 'Server online. Connecting...');
  assert.deepEqual(page.requests, ['https://auraview.invalid/retry-local-server', 'https://auraview.invalid/retry-local-server']);
  assert.deepEqual(page.navigations, []);
  assert.deepEqual(page.delays(), []);
  await page.retry();
  assert.equal(page.requests.length, 2);
});

test('leaving an offline page cancels its scheduled check', () => {
  const page = createPage();
  page.leave();
  assert.deepEqual(page.delays(), []);
  assert.equal(page.requests.length, 0);
});

test('leaving during a native check ignores its reply and cancels all timers', async () => {
  let finish;
  const page = createPage(() => new Promise((resolve) => { finish = resolve; }));
  const attempt = page.fire(10000);
  page.leave();
  finish({});
  await attempt;
  assert.deepEqual(page.navigations, []);
  assert.deepEqual(page.delays(), []);
});
