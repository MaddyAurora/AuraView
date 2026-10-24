import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Downloads, useDownloads } from './Downloads';
import type { DownloadItem } from './Downloads';

interface Bounds { x: number; y: number; width: number; height: number }
export function DownloadsPreview({ visible, anchor, downloads }: { visible: boolean; anchor: RefObject<HTMLDivElement>; downloads: DownloadItem[] }) {
  const isTauri = '__TAURI_INTERNALS__' in window;
  const sequence = useRef(Date.now() * 1000);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    const update = () => {
      const rect = visible ? anchor.current?.getBoundingClientRect() : undefined;
      const next = rect && rect.width > 0 && rect.bottom < window.innerHeight ? { x: rect.left, y: rect.bottom, width: rect.width,
        height: Math.max(1, Math.min(210, 42 + Math.max(1, Math.min(downloads.length, 3)) * 52, window.innerHeight - rect.bottom)) } : null;
      if (isTauri) void invoke('set_downloads_preview', { bounds: next, requestId: ++sequence.current }).catch(console.error);
      else setBounds(next);
    };
    update();
    if (!visible) return;
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [visible, anchor, downloads.length, isTauri]);
  useEffect(() => () => { if (isTauri) void invoke('set_downloads_preview', { bounds: null, requestId: ++sequence.current }).catch(console.error); }, [isTauri]);
  if (isTauri || !visible || !bounds) return null;
  return <div className="pointer-events-none fixed z-50 overflow-hidden shadow-xl" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
    <Downloads downloads={downloads} preview onClose={() => {}} />
  </div>;
}

export function DownloadsPreviewWindow() {
  const [ready, setReady] = useState(false);
  const downloads = useDownloads(() => setReady(true));
  useEffect(() => { if (ready) void invoke('downloads_preview_ready').catch(console.error); }, [ready]);
  return <div className="h-screen overflow-hidden bg-[#111923] pointer-events-none"><Downloads downloads={downloads} preview onClose={() => {}} /></div>;
}
