import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AIServerBookmark } from '../types/browser';
import { ExternalLink, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { aiDockMenu, aiDockPort, aiDockUrl, loadAiDock, moveAiDockServer, putAiDockServer, saveAiDock } from '../lib/aiDock';
import type { AIDockDraft } from '../lib/aiDock';
import { AIDockDialog } from './AIDockDialog';
import { BookmarkMenu } from './BookmarkMenu';
import type { BookmarkMenuState } from './BookmarkMenu';
import { useBookmarkReorder } from '../hooks/useBookmarkReorder';

interface LocalhostDockProps {
  onOpenServer: (url: string, newTab?: boolean) => void;
  onDialogChange: (open: boolean) => void;
}

export const LocalhostDock: React.FC<LocalhostDockProps> = ({ onOpenServer, onDialogChange }) => {
  const [customPort, setCustomPort] = useState('');
  const [initial] = useState(() => {
    try { return { servers: loadAiDock(window.localStorage), error: '' }; }
    catch { return { servers: [] as AIServerBookmark[], error: 'Unable to read Local Hub entries. Your saved data has been left intact.' }; }
  });
  const [servers, setServers] = useState(initial.servers);
  const [error, setError] = useState(initial.error);
  const [draft, setDraft] = useState<AIDockDraft | null>(null);
  const [menu, setMenu] = useState<BookmarkMenuState | null>(null);
  const isTauri = '__TAURI_INTERNALS__' in window;
  const menuBusy = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const reorder = useBookmarkReorder(strip, servers.map((server) => server.id), 'x', (id, index) => {
    if (initial.error) return;
    try {
      const current = loadAiDock(window.localStorage);
      const next = moveAiDockServer(current, id, index);
      if (next === current) return;
      saveAiDock(window.localStorage, next); setServers(next); setError('');
    } catch { setError('Unable to save the Local Hub order. Please try again.'); }
  });
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDialog = () => { setDraft(null); onDialogChange(false); };
  const openEditor = (id?: string) => {
    if (initial.error) return;
    try {
      const server = id ? loadAiDock(window.localStorage).find((item) => item.id === id) : undefined;
      if (id && !server) throw new Error('This Local Hub entry no longer exists.');
      const value: AIDockDraft = server ? { id: server.id, name: server.name, port: String(server.port), color: server.color, description: server.description }
        : { name: '', port: '', color: '#a855f7', description: '' };
      setMenu(null); onDialogChange(true);
      if (isTauri) void invoke('show_ai_dock_editor', { draft: value }).catch(() => {
        setError('Unable to open the Local Hub editor. Please try again.'); onDialogChange(false);
      });
      else setDraft(value);
    } catch (reason) { setError((reason as Error).message); }
  };
  const act = (action: string) => {
    setMenu(null);
    const [kind, id] = action.split(':');
    if (kind === 'add') openEditor();
    if (kind === 'edit' && id) openEditor(id);
    if (kind === 'delete' && id && !initial.error) {
      try {
        const current = loadAiDock(window.localStorage);
        const next = current.filter((item) => item.id !== id);
        if (next.length === current.length) return;
        saveAiDock(window.localStorage, next); setServers(next); setError('');
      } catch { setError('Unable to save Local Hub entries. Please try again.'); }
    }
  };
  const actionRef = useRef(act); actionRef.current = act;
  const dialogChangeRef = useRef(onDialogChange); dialogChangeRef.current = onDialogChange;
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    listen<string>('ai-dock-menu-select', (event) => actionRef.current(event.payload)).then(retain).catch(console.error);
    listen('ai-dock-changed', () => {
      try { setServers(loadAiDock(window.localStorage)); setError(''); }
      catch { setError('Unable to read Local Hub entries. Your saved data has been left intact.'); }
    }).then(retain).catch(console.error);
    listen('ai-dock-editor-closed', () => dialogChangeRef.current(false)).then(retain).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [isTauri]);
  const showMenu = async (event: React.MouseEvent, id?: string) => {
    event.preventDefault(); event.stopPropagation();
    if (initial.error || menuBusy.current) return;
    if (!isTauri) { setMenu({ x: event.clientX, y: event.clientY, items: aiDockMenu(id) }); return; }
    menuBusy.current = true;
    try { await invoke('show_ai_dock_menu', { x: event.clientX, y: event.clientY, serverId: id || null }); }
    catch { setError('Unable to open the Local Hub menu. Please try again.'); }
    finally { menuBusy.current = false; }
  };

  const handleLaunchCustomPort = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onOpenServer(`http://localhost:${aiDockPort(customPort)}`, true);
      setCustomPort(''); setError(initial.error);
    } catch (reason) { setError((reason as Error).message); }
  };

  return (
    <>
    <div role="toolbar" aria-label="Local Hub" onContextMenu={(event) => { void showMenu(event); }} className="bg-[var(--av-0c1017)] border-b border-[var(--av-1a2533)] px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs select-none">
      {/* Quick Launch Chips */}
      <div ref={strip} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto touch-none" {...reorder.events}>
        {reorder.order.map((id) => {
          const server = servers.find((server) => server.id === id)!;
          return (
          <div
            key={server.id}
            data-bookmark-item={server.id}
            onPointerDown={(event) => reorder.onPointerDown(event, server.id)}
            role="button" tabIndex={0} onClick={() => onOpenServer(aiDockUrl(server))}
            onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); } }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault(); event.stopPropagation(); onOpenServer(aiDockUrl(server), true);
            }}
            onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenServer(aiDockUrl(server)); } }}
            onContextMenu={(event) => { void showMenu(event, server.id); }}
            className={`group flex shrink-0 items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--av-131b26)] hover:bg-[var(--av-1a2533)] border border-[var(--av-233346)] hover:border-purple-500/60 transition-all shadow-sm ${reorder.draggedId === server.id ? 'cursor-grabbing opacity-60 ring-1 ring-purple-400' : 'cursor-grab'}`}
            title={`${server.description || server.name} (${aiDockUrl(server)})`}
          >
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: server.color }} />
            <span className="font-medium text-gray-200 group-hover:text-white">
              {server.name}
            </span>
            <span className="text-[10px] text-gray-500 group-hover:text-purple-400 font-mono">
              :{server.port}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenServer(aiDockUrl(server), true);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200 transition-opacity"
              type="button" title="Open in new tab" aria-label={`Open ${server.name} in new tab`}
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </div>
        ); })}
        {!servers.length && !error && <span className="text-gray-500">Right-click to add a port</span>}
      </div>

      {/* Quick Port Jump */}
      <form onSubmit={handleLaunchCustomPort} className="flex shrink-0 items-center gap-1.5">
        <div className="relative flex items-center">
          <span className="absolute left-2 text-gray-500 font-mono text-[11px]">:</span>
          <input
            aria-label="Quick launch port"
            type="number"
            value={customPort}
            onChange={(e) => setCustomPort(e.target.value)}
            placeholder="Port..."
            min="1"
            max="65535"
            className="w-20 pl-4 pr-2 py-1 rounded bg-[var(--av-131b26)] border border-[var(--av-233346)] text-gray-200 text-xs focus:outline-none focus:border-purple-500 font-mono placeholder-gray-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
        <button
          type="submit"
          disabled={!customPort}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white font-medium transition-colors shadow-sm"
        >
          <Plus className="w-3 h-3" />
          <span>Launch</span>
        </button>
      </form>
      {error && <p role="alert" className="w-full text-red-300">{error}</p>}
    </div>
    {menu && <BookmarkMenu menu={menu} label="Local Hub" onSelect={act} onClose={closeMenu} />}
    {draft && <AIDockDialog draft={draft} onClose={closeDialog} onSave={(value) => {
      const next = putAiDockServer(loadAiDock(window.localStorage), value);
      try { saveAiDock(window.localStorage, next); }
      catch { throw new Error('Unable to save Local Hub entries. Please try again.'); }
      setServers(next); setError(''); closeDialog();
    }} />}
    </>
  );
};
