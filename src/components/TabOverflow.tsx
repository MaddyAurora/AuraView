import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Tab } from '../types/browser';
import { orderedTabPages } from '../lib/tabState';
import { overflowButtonWidth } from '../lib/tabSizing';

interface Props { tabs: Tab[]; activeTabId: string; onSelect: (id: string) => void }

export function TabOverflow({ tabs, activeTabId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastClosed = useRef(-Infinity);
  const select = useRef(onSelect);
  select.current = onSelect;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const entries = tabs.map((tab) => ({ id: tab.id,
    title: (tab.splitEnabled ? orderedTabPages(tab) : orderedTabPages(tab).slice(0, 1))
      .map(({ page }) => page.title || page.url || 'New tab').join(' | ') }));
  const cancelTimer = () => clearTimeout(timer.current);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    listen<string>('tab-overflow-select', (event) => select.current(event.payload))
      .then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(console.error);
    return () => { disposed = true; stop?.(); };
  }, [isTauri]);

  useEffect(() => () => cancelTimer(), []);
  useEffect(() => {
    if (!open || isTauri) return;
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open, isTauri]);

  const show = async () => {
    cancelTimer();
    if (busy.current) return;
    if (!isTauri) { setOpen(true); return; }
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    busy.current = true;
    setOpen(true);
    try {
      await invoke('show_tab_overflow', { tabs: entries, activeTabId, x: bounds.left, y: bounds.bottom + 2 });
    } catch (error) { console.error('Unable to open hidden tabs:', error); }
    finally { busy.current = false; lastClosed.current = performance.now(); setOpen(false); }
  };

  if (!tabs.length) return null;
  const label = `${tabs.length} more ${tabs.length === 1 ? 'tab' : 'tabs'}`;
  const activeHidden = tabs.some((tab) => tab.id === activeTabId);
  const bounds = button.current?.getBoundingClientRect();
  return <>
    <button ref={button} type="button" data-tab-overflow-button data-tauri-drag-region="false"
      aria-haspopup="menu" aria-expanded={open} aria-label={label}
      title={label}
      style={{ width: overflowButtonWidth(tabs.length) - 4 }}
      className={`ml-1 flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${activeHidden ? 'border-purple-500/50 bg-purple-500/10 text-purple-300' : 'border-[#263545] text-gray-300 hover:bg-[#1f2937]'}`}
      onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onMouseEnter={() => { if (performance.now() - lastClosed.current > 300) timer.current = setTimeout(() => { void show(); }, 180); }}
      onMouseLeave={cancelTimer} onClick={() => { if (open && !isTauri) setOpen(false); else void show(); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); void show(); } }}>
      <span>{tabs.length}</span><ChevronDown className="h-3 w-3" aria-hidden="true" />
    </button>
    {open && !isTauri && bounds && createPortal(<div ref={menu} role="menu" aria-label="More tabs"
      style={{ top: bounds.bottom + 2, right: Math.max(8, window.innerWidth - bounds.right) }}
      className="fixed z-50 max-h-[60vh] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-[#374151] bg-[#111923] p-1 shadow-2xl"
      onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length
          : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}>
      {entries.map((entry) => <button key={entry.id} type="button" role="menuitemradio"
        aria-checked={entry.id === activeTabId} title={entry.title}
        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#253244] focus:bg-[#253244] focus:outline-none"
        onClick={() => { onSelect(entry.id); setOpen(false); button.current?.focus(); }}>
        <Check className={`h-3 w-3 shrink-0 text-purple-400 ${entry.id === activeTabId ? '' : 'invisible'}`} />
        <span className="truncate">{entry.title}</span>
      </button>)}
    </div>, document.body)}
  </>;
}
