import React from 'react';
import { Bookmark, Check, Columns, Download, Layers } from 'lucide-react';
import { AddressBar, AddressBarProps } from './AddressBar';
import { BrowserSettingsButton } from './BrowserSettings';

interface NavigationBarProps extends AddressBarProps {
  downloadsAnchor?: React.Ref<HTMLDivElement>;
  isSplitActive: boolean;
  showAiDock: boolean;
  showBookmarks: boolean;
  showDownloads: boolean;
  downloadsPinned: boolean;
  downloadCount: number;
  downloadPercent: number | null;
  downloadComplete: boolean;
  onHoverDownloads: (hovering: boolean) => void;
  onToggleDownloads: () => void;
  onToggleSplit: () => void;
  onToggleAiDock: () => void;
  onToggleBookmarks: () => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({ downloadsAnchor, isSplitActive, showAiDock, showBookmarks, showDownloads, downloadsPinned, downloadCount, downloadPercent, downloadComplete,
  onToggleSplit, onToggleAiDock, onToggleBookmarks, onToggleDownloads, onHoverDownloads, ...addressProps }) => (
  <div ref={downloadsAnchor} className="flex shrink-0 items-center gap-2 px-3 py-1.5 bg-[#151e28] border-b border-[#1f2937] text-gray-300 text-xs select-none">
    {isSplitActive ? <span className="flex-1 text-gray-400">Split view <span className="text-gray-500">— AI Dock opens in the left pane</span></span> : <AddressBar {...addressProps} />}
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={onToggleDownloads} onPointerEnter={(event) => { if (event.pointerType !== 'touch') onHoverDownloads(true); }}
        onPointerLeave={() => onHoverDownloads(false)} onPointerCancel={() => onHoverDownloads(false)}
        className={`relative isolate overflow-hidden flex items-center justify-center gap-1 px-2 py-1.5 rounded-md transition-colors border ${downloadComplete ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70' : showDownloads ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`}
        title={downloadComplete ? 'Download complete' : downloadCount ? `Downloading${downloadPercent == null ? '…' : ` · ${Math.round(downloadPercent)}%`}` : 'Downloads'}
        aria-label={`Downloads${downloadCount ? ` (${downloadCount} active)` : downloadComplete ? ' (complete)' : ''}`} aria-pressed={downloadsPinned} aria-expanded={showDownloads}>
        {downloadCount > 0 && <span role="progressbar" aria-label="Total download progress" aria-valuenow={downloadPercent ?? undefined} aria-valuemin={0} aria-valuemax={100}
          className={`pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/45 transition-[width] duration-200 motion-reduce:transition-none ${downloadPercent == null ? 'animate-pulse motion-reduce:animate-none' : ''}`}
          style={{ width: `${downloadPercent ?? 100}%` }} />}
        {downloadComplete ? <Check className="relative z-10 w-3.5 h-3.5" /> : <Download className="relative z-10 w-3.5 h-3.5" />}
        {downloadCount > 0 && <span className="relative z-10">{downloadCount}</span>}
      </button>
      <button onClick={onToggleBookmarks} className={`flex items-center justify-center px-2 py-1.5 rounded-md transition-colors border ${showBookmarks ? 'bg-amber-950/80 text-amber-300 border-amber-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`} title="Bookmarks" aria-label="Bookmarks" aria-pressed={showBookmarks}>
        <Bookmark className="w-3.5 h-3.5" />
      </button>
      <button onClick={onToggleAiDock} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${showAiDock ? 'bg-purple-950/80 text-purple-300 border-purple-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`} title="Toggle Localhost AI Servers Dock" aria-pressed={showAiDock}>
        <Layers className="w-3.5 h-3.5 text-purple-400" /><span>AI Dock</span>
      </button>
      <button onClick={onToggleSplit} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${isSplitActive ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`} title={isSplitActive ? 'Close split view (Ctrl+\\)' : 'Split view (Ctrl+\\)'} aria-pressed={isSplitActive}>
        <Columns className="w-3.5 h-3.5 text-cyan-400" /><span>{isSplitActive ? 'Close Split' : 'Split'}</span>
      </button>
      <BrowserSettingsButton />
    </div>
  </div>
);
