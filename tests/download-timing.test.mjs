import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadTiming } from '../src/lib/downloadProgress.ts';

const now = 1_000_000;
const item = { started: 1, status: 'downloading', downloaded: 10 * 1024 ** 2, total: 100 * 1024 ** 2,
  bytesPerSecond: 1024 ** 2, remainingSeconds: 90, estimateUpdatedAt: now };

test('download estimates format seconds, minutes, and hours alongside the average byte rate', () => {
  assert.equal(downloadTiming(item, now), '1.0 MB/s avg · About 1m 30s left');
  assert.equal(downloadTiming({ ...item, remainingSeconds: 0.2 }, now), '1.0 MB/s avg · About 1s left');
  assert.equal(downloadTiming({ ...item, remainingSeconds: 60 }, now), '1.0 MB/s avg · About 1m left');
  assert.equal(downloadTiming({ ...item, remainingSeconds: 3601 }, now), '1.0 MB/s avg · About 1h 1m left');
  assert.equal(downloadTiming({ ...item, bytesPerSecond: 1500.1 }, now), '1.5 KB/s avg · About 1m 30s left');
});

test('unknown sizes show speed only; startup, stalls, and invalid samples never promise an ETA', () => {
  assert.equal(downloadTiming({ ...item, total: undefined }, now), '1.0 MB/s avg');
  assert.equal(downloadTiming({ ...item, downloaded: item.total }, now), '1.0 MB/s avg');
  for (const bad of [{ bytesPerSecond: undefined }, { bytesPerSecond: 0 }, { bytesPerSecond: NaN },
    { bytesPerSecond: Infinity }, { estimateUpdatedAt: undefined }, { estimateUpdatedAt: now - 10_000 },
    { estimateUpdatedAt: now + 2000 }]) {
    assert.equal(downloadTiming({ ...item, ...bad }, now), 'Estimating time…');
    assert.equal(downloadTiming({ ...item, ...bad, total: undefined }, now), '');
  }
  for (const remainingSeconds of [-1, 0, Infinity, NaN]) {
    assert.equal(downloadTiming({ ...item, remainingSeconds }, now), '1.0 MB/s avg');
  }
});

test('preparing, merging, saving, failures, and completion do not display transfer estimates', () => {
  for (const status of ['preparing', 'merging', 'saving', 'saved', 'error', 'cancelled', 'cancelling', 'deleted']) {
    assert.equal(downloadTiming({ ...item, status }, now), '');
  }
});
