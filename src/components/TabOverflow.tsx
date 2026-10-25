import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Tab } from '../types/browser';
import { overflowButtonWidth } from '../lib/tabSizing';
import { overflowEntries } from '../lib/tabOverflow';
import { TabOverflowMenu } from './TabOverflowMenu';

interface Props { tabs: Tab[]; activeTabId: string; onSelect: (id: string) => void; onCloseTab: (id: string) => void }

export function TabOverflow({ tabs, activeTabId, onSelect, onCloseTab }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const opening = useRef(false);
  const published = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastClosed = useRef(-Infinity);
  const select = useRef(onSelect);
  select.current = onSelect;
  const closeTab = useRef(onCloseTab);
  closeTab.current = onCloseTab;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const entries = overflowEntries(tabs);
  const currentEntries = useRef(entries);
  currentEntries.current = entries;
  const signature = JSON.stringify({ entries, activeTabId });
  const cancelTimer = () => clearTimeout(timer.current);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    listen<string>('tab-overflow-select', (event) => {
      if (currentEntries.current.some((entry) => entry.id === event.payload)) select.current(event.payload);
    }).then(retain).catch(console.error);
    listen<string>('tab-overflow-close-tab', (event) => {
      if (currentEntries.current.some((entry) => entry.id === event.payload)) closeTab.current(event.payload);
    }).then(retain).catch(console.error);
    listen<{ restoreFocus: boolean }>('tab-overflow-closed', (event) => {
      cancelTimer();
      busy.current = false; opening.current = false;
      lastClosed.current = performance.now(); setOpen(false);
      if (event.payload.restoreFocus) button.current?.focus({ preventScroll: true });
    }).then(retain).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [isTauri]);

  useEffect(() => () => {
    cancelTimer();
    if (isTauri && busy.current) void invoke('close_tab_overflow', { restoreFocus: false }).catch(console.error);
  }, [isTauri]);
  useEffect(() => {
    if (!isTauri || !open || published.current === signature) return;
    published.current = signature;
    void invoke('update_tab_overflow', { tabs: entries, activeTabId }).catch(console.error);
  }, [signature, open, isTauri]);
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
    if (busy.current || !entries.length) return;
    if (!isTauri) { setOpen(true); return; }
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    busy.current = true;
    opening.current = true;
    published.current = signature;
    setOpen(true);
    try {
      await invoke('show_tab_overflow', { tabs: entries, activeTabId,
        anchor: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } });
    } catch (error) {
      console.error('Unable to open hidden tabs:', error);
      busy.current = false; lastClosed.current = performance.now(); setOpen(false);
    } finally { opening.current = false; }
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
      onMouseLeave={cancelTimer} onClick={() => {
        if (open && isTauri && !opening.current) void invoke('close_tab_overflow', { restoreFocus: false }).catch(console.error);
        else if (open && !isTauri) setOpen(false);
        else void show();
      }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); void show(); } }}>
      <span>{tabs.length}</span><ChevronDown className="h-3 w-3" aria-hidden="true" />
    </button>
    {open && !isTauri && bounds && createPortal(<div ref={menu}
      style={{ top: bounds.bottom + 4, right: Math.max(8, window.innerWidth - bounds.right),
        height: Math.min(54 + entries.length * 52, Math.max(1, window.innerHeight - bounds.bottom - 12)) }}
      className="fixed z-50 w-[360px] max-w-[calc(100vw-16px)]">
      <TabOverflowMenu entries={entries} activeTabId={activeTabId}
        onCloseTab={onCloseTab}
        onAutoClose={() => setOpen(false)}
        onClose={() => { setOpen(false); button.current?.focus(); }}
        onSelect={(id) => { onSelect(id); setOpen(false); button.current?.focus(); }} />
    </div>, document.body)}
  </>;
}
