import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Download, RotateCw, X } from 'lucide-react';

export interface VideoDownload {
  id: string; title: string; status: string; message: string; downloaded: number;
  total?: number; percent?: number; filename?: string; revision: number;
}
export const downloadBusy = (status: string) => ['preparing', 'downloading', 'merging', 'saving', 'cancelling'].includes(status);
export function useVideoDownloads() {
  const [downloads, setDownloads] = useState<VideoDownload[]>([]);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false, stop: (() => void) | undefined;
    const merge = (incoming: VideoDownload[]) => {
      if (disposed) return;
      setDownloads((previous) => {
        const entries = new Map(previous.map((item) => [item.id, item]));
        for (const item of incoming) if (!entries.has(item.id) || entries.get(item.id)!.revision < item.revision) entries.set(item.id, item);
        return [...entries.values()].slice(-60);
      });
    };
    // Subscribe before taking a snapshot so fast downloads cannot fall through a gap.
    listen<VideoDownload>('video-download-progress', (event) => merge([event.payload])).then((unlisten) => {
      if (disposed) { unlisten(); return; }
      stop = unlisten;
      return invoke<VideoDownload[]>('list_video_downloads').then(merge);
    }).catch(console.error);
    return () => { disposed = true; stop?.(); };
  }, []);
  return downloads;
}
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function VideoDownloads({ downloads, onClose }: { downloads: VideoDownload[]; onClose: () => void }) {
  const [error, setError] = useState('');
  const action = (command: string, id: string) => {
    setError(''); void invoke(command, { id }).catch((e) => setError(String(e)));
  };
  return <section aria-label="Video downloads" className="shrink-0 border-b border-[#263444] bg-[#111923] text-gray-200">
    <div className="flex items-center justify-between px-4 py-2 text-xs">
      <span className="flex items-center gap-2 font-medium"><Download size={14} /> Video downloads <span className="font-normal text-gray-500">Saved to Downloads</span></span>
      <button onClick={onClose} aria-label="Close downloads" title="Close downloads" className="rounded p-1 text-gray-400 hover:bg-gray-700"><X size={14} /></button>
    </div>
    <div className="max-h-40 overflow-y-auto px-4 pb-2">
      {!downloads.length && <p className="py-2 text-xs text-gray-400">Hover over a video and click the download button in its top-right corner.</p>}
      {[...downloads].reverse().map((item) => <div key={item.id} className="flex items-center gap-3 border-t border-gray-800 py-2 text-xs">
        {item.status === 'saved' ? <Check size={16} className="shrink-0 text-emerald-400" /> : <Download size={16} className={`shrink-0 ${item.status === 'error' ? 'text-red-300' : 'text-cyan-300'}`} />}
        <div className="min-w-0 flex-1">
          <p className="truncate" title={item.filename || item.title}>{item.filename || item.title || 'Video'}</p>
          <p className={`mt-0.5 truncate ${item.status === 'error' ? 'text-red-300' : 'text-gray-400'}`} title={item.message}>{item.message}{item.downloaded > 0 && ` · ${size(item.downloaded)}${item.total ? ` / ${size(item.total)}` : ''}`}</p>
          {downloadBusy(item.status) && <div role="progressbar" aria-label={`Download ${item.title}`} aria-valuenow={item.percent ?? undefined} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-1 overflow-hidden rounded bg-gray-700">
            <div className={`h-full rounded bg-cyan-400 ${item.percent == null ? 'animate-pulse' : ''}`} style={{ width: `${item.percent ?? 25}%` }} />
          </div>}
        </div>
        {downloadBusy(item.status) ? <button onClick={() => action('cancel_video_download', item.id)} aria-label={`Cancel ${item.title}`} title="Cancel download" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white"><X size={15} /></button> :
          ['error', 'cancelled'].includes(item.status) && <button onClick={() => action('retry_video_download', item.id)} aria-label={`Retry ${item.title}`} title="Retry download" className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white"><RotateCw size={15} /></button>}
      </div>)}
    </div>
    {error && <p role="alert" className="px-4 pb-2 text-xs text-red-300">{error}</p>}
  </section>;
}
