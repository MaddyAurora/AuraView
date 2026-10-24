import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Download, FolderOpen, RotateCw, Trash2, X } from 'lucide-react';
import { downloadBatch, downloadBusy, DownloadBatch, downloadSize as size, downloadTiming } from '../lib/downloadProgress';
export { downloadBusy } from '../lib/downloadProgress';

export interface DownloadItem {
  id: string; title: string; status: string; message: string; downloaded: number;
  total?: number; percent?: number; filename?: string; revision: number;
  kind: 'video' | 'image' | 'browser'; started: number; cancelable: boolean; retryable: boolean;
  completedAt?: number;
  hasFile?: boolean; fileDeleted?: boolean; redownloadable?: boolean;
  bytesPerSecond?: number; remainingSeconds?: number; estimateUpdatedAt?: number;
}
export function useDownloads(onReady?: () => void) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false, generation = 0, clearedThrough = 0;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const merge = (incoming: DownloadItem[], live = false) => {
      if (disposed) return;
      setDownloads((previous) => {
        const entries = new Map(previous.map((item) => [item.id, item]));
        for (const item of incoming) {
          if (item.revision <= clearedThrough) continue;
          const old = entries.get(item.id);
          if (!old || old.revision < item.revision) {
            const finishing = ['merging', 'saving', 'saved', 'deleted'].includes(item.status);
            const total = item.total ?? (finishing ? old?.total ?? (['saved', 'deleted'].includes(item.status) && item.downloaded > 0 ? item.downloaded : undefined) : undefined);
            const downloaded = finishing && item.downloaded === 0 ? total ?? old?.downloaded ?? 0 : item.downloaded;
            entries.set(item.id, { ...item, total, downloaded,
              completedAt: item.status === 'saved' ? old?.completedAt ?? (live ? Date.now() : undefined) : undefined });
          } else if (live && item.revision === old.revision && item.status === 'saved' && !old.completedAt) {
            // A snapshot can beat delivery of the same live completion event.
            entries.set(item.id, { ...old, completedAt: Date.now() });
          }
        }
        const ordered = [...entries.values()].sort((a, b) => a.started - b.started);
        let completed = ordered.filter((item) => !downloadBusy(item.status)).length;
        return ordered.filter((item) => {
          if (completed > 60 && !downloadBusy(item.status)) { completed--; return false; }
          return true;
        });
      });
    };
    // Subscribe before taking a snapshot so fast downloads cannot fall through a gap.
    Promise.all([
      listen<DownloadItem>('download-progress', (event) => merge([event.payload], true)).then(retain),
      listen<{ entries: DownloadItem[]; revision: number }>('downloads-history-cleared', (event) => {
        if (event.payload.revision <= clearedThrough) return;
        clearedThrough = event.payload.revision;
        generation++;
        if (!disposed) setDownloads((previous) => {
          const active = new Map(event.payload.entries.map((item) => [item.id, item]));
          for (const item of previous) {
            const retained = active.get(item.id);
            if (item.revision > clearedThrough || (retained && item.revision >= retained.revision)) active.set(item.id, item);
          }
          return [...active.values()].sort((a, b) => a.started - b.started);
        });
      }).then(retain),
    ]).then(() => {
      if (disposed) return;
      const snapshotGeneration = generation;
      return invoke<DownloadItem[]>('list_downloads').then((items) => {
        if (generation === snapshotGeneration) merge(items);
        if (!disposed) onReady?.();
      });
    }).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);
  return downloads;
}

export function useDownloadIndicator(downloads: DownloadItem[]) {
  const count = downloads.filter((item) => downloadBusy(item.status)).length;
  const [batch, setBatch] = useState<DownloadBatch>({ started: null, percent: null });
  const [complete, setComplete] = useState(false);
  const latest = downloads.reduce<DownloadItem | undefined>((last, item) => !last || item.revision > last.revision ? item : last, undefined);
  const completedAt = !count && latest?.status === 'saved' ? latest.completedAt : undefined;
  useEffect(() => { setBatch((previous) => downloadBatch(previous, downloads)); }, [downloads]);
  useEffect(() => {
    const remaining = completedAt ? completedAt + 5000 - Date.now() : 0;
    setComplete(remaining > 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setComplete(false), remaining);
    return () => clearTimeout(timer);
  }, [completedAt]);
  return { count, percent: batch.percent, complete: !count && Boolean(completedAt) && complete };
}
export function Downloads({ downloads, onClose, preview = false }: { downloads: DownloadItem[]; onClose: () => void; preview?: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const transferring = downloads.some((item) => item.status === 'downloading');
  useEffect(() => {
    if (!transferring) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [transferring]);
  const action = (command: string, id: string) => {
    if (pending[id]) return;
    setError(''); setPending((previous) => ({ ...previous, [id]: true }));
    void invoke(command, { id }).catch((e) => setError(String(e)))
      .finally(() => setPending((previous) => { const next = { ...previous }; delete next[id]; return next; }));
  };
  return <section aria-label="Downloads" className="shrink-0 border-b border-[#263444] bg-[#111923] text-gray-200">
    <div className="flex items-center justify-between px-4 py-2 text-xs">
      <span className="flex items-center gap-2 font-medium"><Download size={14} /> Downloads <span className="font-normal text-gray-500">{preview ? 'Preview · click Downloads to keep open' : 'Saved to Downloads'}</span></span>
      {!preview && <button onClick={onClose} aria-label="Close downloads" title="Close downloads" className="rounded p-1 text-gray-400 hover:bg-gray-700"><X size={14} /></button>}
    </div>
    <div className="max-h-40 overflow-y-auto px-4 pb-2">
      {!downloads.length && <p className="py-2 text-xs text-gray-400">Your image, video, and file downloads will appear here.</p>}
      {[...downloads].reverse().map((item) => {
        const timing = downloadTiming(item, Math.max(now, Date.now()));
        const detail = `${item.message}${item.downloaded > 0 ? ` · ${size(item.downloaded)}${item.total ? ` / ${size(item.total)}` : ''}` : ''}`;
        return <div key={item.id} className="flex items-center gap-3 border-t border-gray-800 py-2 text-xs">
        {item.status === 'saved' ? <Check size={16} className="shrink-0 text-emerald-400" /> : item.status === 'deleted' ? <Trash2 size={16} className="shrink-0 text-gray-500" /> : <Download size={16} className={`shrink-0 ${item.status === 'error' ? 'text-red-300' : 'text-cyan-300'}`} />}
        <div className="min-w-0 flex-1">
          <p className="truncate" title={item.filename || item.title}>{item.filename || item.title || 'Download'}</p>
          <p className={`mt-0.5 flex gap-2 ${item.status === 'error' ? 'text-red-300' : 'text-gray-400'}`} title={`${detail}${timing ? ` · ${timing}` : ''}`}>
            <span className="truncate">{detail}</span>
            {timing && <span className="shrink-0 whitespace-nowrap text-gray-300">{timing}</span>}
          </p>
          {downloadBusy(item.status) && <div role="progressbar" aria-label={`Download ${item.title}`} aria-valuenow={item.percent ?? undefined} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1 overflow-hidden rounded bg-gray-700">
            <div className={`h-full rounded bg-cyan-400 ${item.percent == null ? 'animate-pulse' : ''}`} style={{ width: `${item.percent ?? 25}%` }} />
          </div>}
        </div>
        {!preview && <div className="flex shrink-0 items-center gap-1">
          {item.hasFile && <button disabled={pending[item.id]} onClick={() => action('reveal_download', item.id)} aria-label={`Show ${item.filename || item.title} in folder`} title="Show in folder" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-40"><FolderOpen size={15} /></button>}
          {item.redownloadable && <button disabled={pending[item.id]} onClick={() => action('redownload_download', item.id)} aria-label={`Download ${item.filename || item.title} again`} title="Download again (saves a new copy)" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-40"><Download size={15} /></button>}
          {item.hasFile && !item.fileDeleted && <button disabled={pending[item.id]} onClick={() => action('delete_download', item.id)} aria-label={`Delete ${item.filename || item.title}`} title="Delete file (Recycle Bin)" className="rounded p-1.5 text-gray-400 hover:bg-red-950/70 hover:text-red-300 disabled:opacity-40"><Trash2 size={15} /></button>}
          {downloadBusy(item.status) && item.cancelable ? <button disabled={pending[item.id]} onClick={() => action('cancel_download', item.id)} aria-label={`Cancel ${item.title}`} title="Cancel download" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-40"><X size={15} /></button> :
            ['error', 'cancelled'].includes(item.status) && item.retryable && <button disabled={pending[item.id]} onClick={() => action('retry_download', item.id)} aria-label={`Retry ${item.title}`} title="Retry download" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-40"><RotateCw size={15} /></button>}
        </div>}
      </div>; })}
    </div>
    {error && <p role="alert" className="px-4 pb-2 text-xs text-red-300">{error}</p>}
  </section>;
}
