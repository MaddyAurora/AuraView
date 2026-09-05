import React, { useState, useEffect } from 'react';
import { Tab } from '../types/browser';
import { Plus, X, Server, Globe, Loader2, Minus, Square, Copy, Terminal } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

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
      <div
        className="flex items-center gap-1 overflow-x-auto h-full pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0 max-w-[65%]"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            handleStartDrag(e);
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isLocalhost = tab.url.includes('localhost') || tab.url.includes('127.0.0.1');

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              data-tauri-drag-region="false"
              className={`group relative flex items-center gap-2 px-3 py-1.5 h-9 min-w-[120px] max-w-[200px] rounded-t-md text-xs font-medium cursor-pointer transition-all border-t border-x ${
                isActive
                  ? 'bg-[#151e28] text-gray-100 border-[#374151] shadow-sm'
                  : 'bg-[#0f141b] text-gray-400 border-transparent hover:bg-[#121820] hover:text-gray-300'
              }`}
            >
              {tab.isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
              ) : isLocalhost ? (
                <Server className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-purple-400' : 'text-gray-500'}`} />
              ) : (
                <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-gray-500'}`} />
              )}

              <span className="truncate flex-1 text-left select-none">
                {tab.title || (isLocalhost ? 'Local AI Server' : 'New Tab')}
              </span>

              <button
                onClick={(e) => onCloseTab(tab.id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                data-tauri-drag-region="false"
                className={`p-0.5 rounded-sm hover:bg-gray-700/60 transition-opacity ${
                  isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
                }`}
                title="Close Tab (Ctrl+W)"
              >
                <X className="w-3 h-3" />
              </button>

              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-cyan-400 to-purple-500 rounded-t-sm" />
              )}
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          onMouseDown={(e) => e.stopPropagation()}
          data-tauri-drag-region="false"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-[#1f2937]/50 transition-colors ml-1 shrink-0 cursor-pointer"
          title="New Tab (Ctrl+T)"
        >
          <Plus className="w-4 h-4 pointer-events-none" />
        </button>
      </div>

      {/* Draggable space after tabs - fills remaining horizontal space */}
      <div
        className="flex-1 h-full min-w-[30px] cursor-default"
        onMouseDown={handleStartDrag}
        onDoubleClick={handleToggleMaximize}
        data-tauri-drag-region
      />

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
    </div>
  );
};
