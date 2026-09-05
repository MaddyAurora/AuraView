import React from 'react';
import { Tab } from '../types/browser';
import { Plus, X, Server, Globe, Loader2, Minus, Square } from 'lucide-react';

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
  const handleMinimize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('app_minimize');
    } catch (err) {
      console.log('Window minimize:', err);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('app_toggle_maximize');
    } catch (err) {
      console.log('Window toggle maximize:', err);
    }
  };

  const handleClose = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('app_close');
    } catch (err) {
      console.log('Window close:', err);
    }
  };

  return (
    <div
      className="flex items-center bg-[#090c10] border-b border-[#1f2937] pl-2 pr-0 select-none h-10 gap-1 overflow-hidden"
      data-tauri-drag-region
    >
      {/* Brand Icon & Name */}
      <div
        className="flex items-center gap-2 px-2.5 py-1 text-xs font-semibold tracking-wider text-purple-400 shrink-0 cursor-default"
        data-tauri-drag-region
      >
        <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-400 flex items-center justify-center shadow-sm shadow-purple-500/30">
          <div className="w-1.5 h-1.5 rounded-full bg-[#090c10]"></div>
        </div>
        <span className="hidden sm:inline bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent font-bold tracking-tight">
          AuraView
        </span>
      </div>

      {/* Tabs Container */}
      <div
        className="flex items-center flex-1 gap-1 overflow-x-auto h-full no-scrollbar pt-1"
        data-tauri-drag-region
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isLocalhost = tab.url.includes('localhost') || tab.url.includes('127.0.0.1');

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-2 px-3 py-1.5 h-9 min-w-[120px] max-w-[220px] rounded-t-md text-xs font-medium cursor-pointer transition-all border-t border-x ${
                isActive
                  ? 'bg-[#151e28] text-gray-100 border-[#374151] shadow-sm'
                  : 'bg-[#0f141b] text-gray-400 border-transparent hover:bg-[#121820] hover:text-gray-300'
              }`}
            >
              {/* Tab Icon */}
              {tab.isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
              ) : isLocalhost ? (
                <Server className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-purple-400' : 'text-gray-500'}`} />
              ) : (
                <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-gray-500'}`} />
              )}

              {/* Tab Title */}
              <span className="truncate flex-1 text-left select-none">
                {tab.title || (isLocalhost ? 'Local AI Server' : 'New Tab')}
              </span>

              {/* Close Button */}
              <button
                onClick={(e) => onCloseTab(tab.id, e)}
                className={`p-0.5 rounded-sm hover:bg-gray-700/60 transition-opacity ${
                  isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
                }`}
                title="Close Tab (Ctrl+W)"
              >
                <X className="w-3 h-3" />
              </button>

              {/* Active Tab Accent Bar */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-cyan-400 to-purple-500 rounded-t-sm" />
              )}
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          onClick={onNewTab}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-[#1f2937]/50 transition-colors ml-1"
          title="New Tab (Ctrl+T)"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Draggable space after tabs */}
        <div className="flex-1 h-full min-w-[20px]" data-tauri-drag-region />
      </div>

      {/* Integrated Native Window Controls */}
      <div className="flex items-center h-full select-none shrink-0" data-tauri-drag-region>
        <button
          onClick={handleMinimize}
          className="h-10 w-11 flex items-center justify-center hover:bg-[#1a2533] text-gray-400 hover:text-white transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="h-10 w-11 flex items-center justify-center hover:bg-[#1a2533] text-gray-400 hover:text-white transition-colors"
          title="Maximize / Restore"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="h-10 w-11 flex items-center justify-center hover:bg-[#e81123] text-gray-400 hover:text-white transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
