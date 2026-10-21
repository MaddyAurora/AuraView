import React, { useState, useEffect, useRef } from 'react';
import { BrowserPane, Tab } from '../types/browser';
import { Plus, X, Server, Globe, Loader2, Minus, Square, Copy, Terminal, Link2, ArrowLeftRight } from 'lucide-react';
import { orderedTabPages } from '../lib/tabState';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useTabReorder } from '../hooks/useTabReorder';
import { useTabSizing } from '../hooks/useTabSizing';
import { TabOverflow } from './TabOverflow';
import { TabContextMenu, TabMenuTarget } from './TabContextMenu';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onCloseTabPage: (id: string, pane: BrowserPane, e?: React.MouseEvent) => void;
  onNewTab: () => void;
  onSwapTabPages: (id: string) => void;
  onMoveTab: (id: string, toIndex: number) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseTabPage,
  onNewTab,
  onSwapTabPages,
  onMoveTab,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [contextMenu, setContextMenu] = useState<TabMenuTarget | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tabAreaRef = useRef<HTMLDivElement>(null);
  const newTabRef = useRef<HTMLButtonElement>(null);
  const tabDrag = useTabReorder(stripRef, tabs, onSelectTab, onMoveTab);
  const tabSizes = useTabSizing(tabAreaRef, stripRef, newTabRef, tabs, Boolean(tabDrag.draggedTabId));
  const visibleCount = tabSizes.visibleCount ?? tabs.length;
  const hiddenTabs = tabs.slice(visibleCount);
  const pageActions = useRef({ tabs, onCloseTabPage });
  pageActions.current = { tabs, onCloseTabPage };
  const closePage = (pageId: string) => {
    // Resolve the current owner because a page can move out of a split while
    // the native popup is open. Its stable page ID still selects the right one.
    for (const owner of pageActions.current.tabs) {
      const entry = orderedTabPages(owner).find(({ page }) => page.id === pageId);
      if (entry) { pageActions.current.onCloseTabPage(owner.id, entry.pane); break; }
    }
  };

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    listen<string>('tab-context-close-page', (event) => closePage(event.payload))
      .then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(console.error);
    return () => { disposed = true; stop?.(); };
  }, []);

  // Keep track of maximized state
  useEffect(() => {
    window.onerror = (message, source, lineno, colno) => {
      invoke('log_client_event', { msg: `JS ERROR: ${message} at ${source}:${lineno}:${colno}` }).catch(() => {});
    };
    window.onunhandledrejection = (event) => {
      invoke('log_client_event', { msg: `PROMISE REJECTION: ${event.reason}` }).catch(() => {});
    };

    const updateMaximized = async () => {
      try {
        const maximized = await invoke<boolean>('app_is_maximized');
        setIsMaximized(maximized);
      } catch {
        try {
          const maximized = await getCurrentWindow().isMaximized();
          setIsMaximized(maximized);
        } catch {
          // ignore
        }
      }
    };

    updateMaximized();
    window.addEventListener('resize', updateMaximized);
    return () => window.removeEventListener('resize', updateMaximized);
  }, []);

  const handleStartDrag = async (e: React.MouseEvent) => {
    // Only drag on left mouse button click
    if (e.button !== 0) return;

    // Do not initiate drag if user clicked an interactive child
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('a')) {
      return;
    }

    try {
      await invoke('log_client_event', { msg: 'handleStartDrag starting native drag' });
      await invoke('app_start_dragging');
    } catch (err) {
      console.log('App start dragging error, trying window API:', err);
      try {
        await getCurrentWindow().startDragging();
      } catch (e2) {
        console.log('Fallback startDragging error:', e2);
      }
    }
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('log_client_event', { msg: 'handleMinimize called' });
      await invoke('app_minimize');
    } catch (err: any) {
      console.log('Minimize error, trying fallback:', err);
      try {
        await getCurrentWindow().minimize();
      } catch (e2) {
        console.log('Fallback minimize error:', e2);
      }
    }
  };

  const handleToggleMaximize = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('log_client_event', { msg: 'handleToggleMaximize called' });
      const nowMax = await invoke<boolean>('app_toggle_maximize');
      setIsMaximized(nowMax);
    } catch (err: any) {
      console.log('Maximize error, trying fallback:', err);
      try {
        await getCurrentWindow().toggleMaximize();
        const max = await getCurrentWindow().isMaximized();
        setIsMaximized(max);
      } catch (e2) {
        console.log('Fallback toggle maximize error:', e2);
      }
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('log_client_event', { msg: 'handleClose called' });
      await invoke('app_close');
    } catch (err: any) {
      console.log('Close error, trying fallback:', err);
      try {
        await getCurrentWindow().close();
      } catch (e2) {
        console.log('Fallback close error:', e2);
      }
    }
  };

  const handleOpenDevTools = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('log_client_event', { msg: 'handleOpenDevTools called' });
      await invoke('app_open_devtools');
    } catch (err: any) {
      console.log('DevTools error:', err);
    }
  };

  return (
    <div
      className="flex items-center bg-[#090c10] border-b border-[#1f2937] pl-2 pr-0 select-none h-10 overflow-hidden w-full cursor-default"
      onMouseDown={handleStartDrag}
      onDoubleClick={handleToggleMaximize}
      data-tauri-drag-region
    >
      {/* Brand Icon & Name */}
      <div
        className="flex items-center gap-2 px-2.5 py-1 text-xs font-semibold tracking-wider text-purple-400 shrink-0 cursor-default"
        onMouseDown={handleStartDrag}
        onDoubleClick={handleToggleMaximize}
        data-tauri-drag-region
      >
        <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-400 flex items-center justify-center shadow-sm shadow-purple-500/30 pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-[#090c10]"></div>
        </div>
        <span className="hidden sm:inline bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent font-bold tracking-tight pointer-events-none">
          AuraView
        </span>
      </div>

      {/* Tabs Container */}
      <div ref={tabAreaRef} className="flex flex-1 min-w-0 h-full items-center">
      <div
        ref={stripRef} {...tabDrag.stripEvents}
        data-maximized={isMaximized}
        onDoubleClick={(event) => event.stopPropagation()}
        data-tab-overflowing={hiddenTabs.length > 0}
        className="browser-tab-strip flex min-w-0 items-center overflow-hidden h-full pt-1"
        style={{ cursor: tabDrag.draggedTabId ? 'grabbing' : undefined, width: tabSizes.stripWidth }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            handleStartDrag(e);
          }
        }}
      >
        {tabs.flatMap((tab, tabIndex) => {
          const isActive = tab.id === activeTabId;
          const orderedPages = orderedTabPages(tab);
          const pages = tab.splitEnabled ? orderedPages : orderedPages.slice(0, 1);
          const linked = pages.length === 2;
          const tabTitle = linked ? `${pages[0].page.title} | ${pages[1].page.title} (Split view)` : pages[0].page.title;

          return pages.map(({ pane, page }, index) => {
            const linkedFirst = linked && index === 0;
            const linkedLast = linked && index === 1;
            const isLocalhost = page.isAiServer || /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(page.url);
            return (
            <div
              // Keep each page mounted when its split group becomes two tabs.
              key={page.id}
              data-tab-page={page.id}
              data-tab-owner={tab.id}
              data-tab-overflow={tabIndex >= visibleCount}
              aria-hidden={tabIndex >= visibleCount}
              onPointerDown={(event) => tabDrag.onPointerDown(event, tab.id)}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const target = { pageId: page.id, x: event.clientX, y: event.clientY, canClose: linked || tabs.length > 1 };
                if ('__TAURI_INTERNALS__' in window) invoke('show_tab_context_menu', target).catch(console.error);
                else setContextMenu(target);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseTabPage(tab.id, pane, event);
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
                if (event.button === 1) event.preventDefault();
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              data-tauri-drag-region="false"
              title={tabTitle}
              aria-label={tabTitle}
              style={{ display: tabIndex >= visibleCount ? 'none' : undefined, marginRight: linkedFirst ? 0 : 4,
                borderTopLeftRadius: linkedLast ? 0 : 6, borderTopRightRadius: linkedFirst ? 0 : 6,
                '--tab-width': `${tabSizes.widths[page.id] ?? 176}px` } as React.CSSProperties}
              className={`browser-tab-page group relative flex min-w-0 shrink-0 items-center gap-2 px-3 py-1.5 h-9 text-xs font-medium cursor-pointer border-t border-x ${
                isActive
                  ? 'bg-[#151e28] text-gray-100 border-[#374151] shadow-sm'
                  : 'bg-[#0f141b] text-gray-400 border-transparent hover:bg-[#121820] hover:text-gray-300'
              } ${linkedFirst ? '!border-r-transparent' : ''} ${linkedLast ? '!border-l-transparent' : ''}`}
            >
              {page.isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
              ) : isLocalhost ? (
                <Server className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-purple-400' : 'text-gray-500'}`} />
              ) : (
                <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-gray-500'}`} />
              )}

              <span className="truncate flex-1 text-left select-none">
                <span data-tab-title={page.id} className="inline-block whitespace-nowrap">
                  {page.title || (isLocalhost ? 'Local AI Server' : 'New Tab')}
                </span>
              </span>

                <button type="button" onClick={(event) => { event.stopPropagation(); onSwapTabPages(tab.id); }}
                  onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
                  title={linkedFirst ? 'Swap left and right pages' : undefined}
                  aria-label={linkedFirst ? 'Swap left and right pages' : undefined}
                  aria-hidden={!linkedFirst} disabled={!linkedFirst} tabIndex={linkedFirst ? 0 : -1}
                  className={`group/swap absolute -right-2.5 top-1/2 z-10 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-purple-400 transition-opacity duration-200 motion-reduce:transition-none hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${isActive ? 'bg-[#151e28]' : 'bg-[#0f141b]'} ${linkedFirst ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  <Link2 className="w-3.5 h-3.5 transition-opacity group-hover/swap:opacity-0 group-focus-visible/swap:opacity-0 pointer-events-none" aria-label={linkedFirst ? 'Linked split pages' : undefined} />
                  <ArrowLeftRight className="absolute w-3.5 h-3.5 opacity-0 transition-opacity group-hover/swap:opacity-100 group-focus-visible/swap:opacity-100 pointer-events-none" aria-hidden="true" />
                </button>

              <button
                onClick={(e) => onCloseTab(tab.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                data-tauri-drag-region="false"
                disabled={linkedFirst} tabIndex={linkedFirst ? -1 : 0} aria-hidden={linkedFirst}
                data-pair-hidden={linkedFirst}
                className={`browser-tab-close shrink-0 rounded-sm hover:bg-gray-700/60 ${
                  linkedFirst ? 'opacity-0 pointer-events-none' : isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
                }`}
                title={linked ? 'Close split tab (Ctrl+W)' : 'Close Tab (Ctrl+W)'}
              >
                <X className="w-3 h-3" />
              </button>

              <div aria-hidden="true"
                style={{ left: linkedLast ? -1 : 0, right: linkedFirst ? -1 : 0,
                  borderTopLeftRadius: linkedLast ? 0 : 2, borderTopRightRadius: linkedFirst ? 0 : 2 }}
                className={`pointer-events-none absolute top-0 h-[2px] bg-gradient-to-r transition-opacity duration-200 motion-reduce:transition-none ${linkedFirst ? 'from-purple-500 to-cyan-400' : linkedLast ? 'from-cyan-400 to-purple-500' : 'from-purple-500 via-cyan-400 to-purple-500'} ${isActive ? 'opacity-100' : 'opacity-0'}`} />
            </div>
            );
          });
        })}
      </div>

        <TabOverflow tabs={hiddenTabs} activeTabId={activeTabId} onSelect={onSelectTab} />

        <button
          ref={newTabRef}
          onClick={onNewTab}
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-[#1f2937]/50 transition-colors ml-1 shrink-0 cursor-pointer"
          title="New Tab (Ctrl+T)"
        >
          <Plus className="w-4 h-4 pointer-events-none" />
        </button>

      {/* Draggable space after tabs - fills remaining horizontal space */}
      <div
        className="flex-1 h-full min-w-[30px] cursor-default"
        onMouseDown={handleStartDrag}
        onDoubleClick={handleToggleMaximize}
        data-tauri-drag-region
      />
      </div>

      {/* Window Controls & DevTools */}
      <div
        className="flex items-center h-full select-none shrink-0"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleOpenDevTools}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="h-10 w-9 flex items-center justify-center hover:bg-[#1a2533] text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer"
          title="Open DevTools Console"
        >
          <Terminal className="w-3.5 h-3.5 pointer-events-none" />
        </button>
        <button
          type="button"
          onClick={handleMinimize}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="h-10 w-11 flex items-center justify-center hover:bg-[#1a2533] text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5 pointer-events-none" />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="h-10 w-11 flex items-center justify-center hover:bg-[#1a2533] text-gray-400 hover:text-white transition-colors cursor-pointer"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 pointer-events-none" />
          ) : (
            <Square className="w-3 h-3 pointer-events-none" />
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="h-10 w-11 flex items-center justify-center hover:bg-[#e81123] text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-3.5 h-3.5 pointer-events-none" />
        </button>
      </div>
      {contextMenu && <TabContextMenu target={contextMenu} onDismiss={() => setContextMenu(null)}
        onClosePage={closePage} />}
    </div>
  );
};
