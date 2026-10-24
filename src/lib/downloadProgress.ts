export const downloadBusy = (status: string) => ['preparing', 'downloading', 'merging', 'saving', 'cancelling'].includes(status);

interface Transfer {
  status: string; started: number; downloaded: number; total?: number;
}
interface TimedTransfer extends Transfer {
  bytesPerSecond?: number; remainingSeconds?: number; estimateUpdatedAt?: number;
}

export const downloadSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
  : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} B`;

export function downloadTiming(item: TimedTransfer, now: number): string {
  if (item.status !== 'downloading') return '';
  const rate = item.bytesPerSecond, updated = item.estimateUpdatedAt;
  const knownSize = item.total != null && Number.isFinite(item.total) && item.total > item.downloaded;
  // A cached hover window must not keep promising an old ETA after a stall.
  if (rate == null || !Number.isFinite(rate) || rate <= 0 || updated == null
    || !Number.isFinite(updated) || now - updated >= 10_000 || updated > now + 1000) {
    return knownSize ? 'Estimating time…' : '';
  }
  const speed = `${downloadSize(rate)}/s avg`;
  const remaining = item.remainingSeconds;
  if (!knownSize || remaining == null || !Number.isFinite(remaining) || remaining <= 0) return speed;
  const seconds = Math.ceil(remaining);
  const minutes = Math.ceil(seconds / 60);
  const time = seconds < 60 ? `${seconds}s`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return `${speed} · About ${time} left`;
}
export interface DownloadBatch { started: number | null; percent: number | null }

export function downloadBatch(previous: DownloadBatch, downloads: Transfer[]): DownloadBatch {
  const finished = (item: Transfer) => ['saved', 'deleted'].includes(item.status);
  const active = downloads.filter((item) => downloadBusy(item.status));
  if (!active.length) return { started: null, percent: null };
  const started = previous.started ?? Math.min(...active.map((item) => item.started));
  // Keep finished members in the current batch so completing a small file does
  // not make the combined bar jump backwards while a larger file continues.
  const batch = downloads.filter((item) => downloadBusy(item.status) || (finished(item) && item.started >= started));
  const sizes = batch.map((item) => item.total ?? (finished(item) ? item.downloaded : undefined));
  if (sizes.some((size, index) => size == null || !Number.isFinite(size) || size < 0 || (size === 0 && downloadBusy(batch[index].status)))) return { started, percent: null };
  const total = sizes.reduce<number>((sum, size) => sum + size!, 0);
  const received = batch.reduce((sum, item, index) => sum + (finished(item) ? sizes[index]! : Math.max(0, Math.min(item.downloaded, sizes[index]!))), 0);
  return { started, percent: Math.min(100, received / total * 100) };
}
