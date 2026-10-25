import { useLayoutEffect, useRef } from 'react';
import { Check, Globe, Link2, Loader2, VolumeX } from 'lucide-react';
import { SiteIcon } from './SiteIcon';
import type { OverflowEntry } from '../lib/tabOverflow';
import { overflowFocusIndex, overflowPageLabel } from '../lib/tabOverflow';
import { useMenuAutoClose } from '../hooks/useMenuAutoClose';

export function TabOverflowMenu({ entries, activeTabId, onSelect, onCloseTab, onClose, onAutoClose = onClose, autoCloseEnabled = true }: {
  entries: OverflowEntry[]; activeTabId: string; onSelect: (id: string) => void; onCloseTab: (id: string) => void; onClose: () => void;
  onAutoClose?: () => void; autoCloseEnabled?: boolean;
}) {
  const idle = useMenuAutoClose(onAutoClose, autoCloseEnabled);
  const list = useRef<HTMLDivElement>(null);
  const ids = entries.map((entry) => entry.id).join('\n');
  useLayoutEffect(() => {
    const current = list.current;
    if (!current) return;
    const items = Array.from(current.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const item = items.find((node) => node.dataset.tabId === activeTabId) || items[0];
    // Preserve the user's place when a title or favicon updates in the background.
    if (!current.contains(document.activeElement)) {
      item?.focus({ preventScroll: true });
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [ids, activeTabId]);

  return <div ref={idle.ref} onMouseEnter={idle.onMouseEnter} onMouseLeave={idle.onMouseLeave}
    className="tab-overflow-menu flex h-full min-h-0 flex-col overflow-hidden rounded-[9px] border border-white/20 bg-[#111923] text-white shadow-2xl"
    onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); event.stopPropagation(); }}
    onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
    onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      idle.onKeyDown();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
      const next = overflowFocusIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
      if (next < 0) return;
      event.preventDefault(); event.stopPropagation();
      items[next]?.focus({ preventScroll: true });
      items[next]?.scrollIntoView({ block: 'nearest' });
    }}>
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-3.5 text-[11px] text-[#a7b6c8]">
      <span>More tabs</span><span className="rounded bg-white/5 px-1.5 py-0.5 tabular-nums text-gray-400">{entries.length}</span>
    </div>
    <div ref={list} role="menu" aria-label="More tabs" className="tab-overflow-list min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
      {entries.map((entry) => <button key={entry.id} type="button" role="menuitemradio" data-tab-id={entry.id}
        aria-checked={entry.id === activeTabId} title={entry.pages.map((page) => `${page.title}\n${page.url}`).join('\n\n')}
        onClick={() => onSelect(entry.id)}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault(); event.stopPropagation(); onCloseTab(entry.id);
        }}
        className={`flex h-[52px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-400/50 ${entry.id === activeTabId ? 'bg-cyan-400/10' : ''}`}>
        <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
          {entry.pages.map((page, index) => <span key={index} className="flex h-5 w-5 items-center justify-center">
            {page.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              : <SiteIcon favicon={page.favicon} fallback={<Globe className="h-3.5 w-3.5 text-gray-400" />} />}
          </span>)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-gray-100">{entry.title}</span>
          <span className="mt-1 block truncate text-[11px] text-[#a7b6c8]">{entry.pages.map(overflowPageLabel).join(' · ')}</span>
        </span>
        {entry.pages.length === 2 && <Link2 className="h-3 w-3 shrink-0 text-purple-400" aria-label="Linked split pages" />}
        {entry.pages.some((page) => page.isMuted) && <VolumeX className="h-3 w-3 shrink-0 text-amber-400" aria-label="Tab muted" />}
        <Check className={`h-3.5 w-3.5 shrink-0 text-cyan-300 ${entry.id === activeTabId ? '' : 'invisible'}`} aria-hidden="true" />
      </button>)}
    </div>
  </div>;
}
