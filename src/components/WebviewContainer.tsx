import React from 'react';
import { Tab } from '../types/browser';
import { Globe, Server, ShieldCheck, Video } from 'lucide-react';

interface WebviewContainerProps {
  activeTab: Tab;
  splitTab?: Tab;
  isSplitActive: boolean;
  vramSaverActive: boolean;
}

export const WebviewContainer: React.FC<WebviewContainerProps> = ({
  activeTab,
  splitTab,
  isSplitActive,
  vramSaverActive,
}) => {
  // Check if running inside Tauri window
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const renderTabContent = (tab: Tab, _isSplitPane = false) => {
    const isLocalhost = tab.url.includes('localhost') || tab.url.includes('127.0.0.1');
    const isYouTube = tab.url.includes('youtube.com') || tab.url.includes('youtu.be');

    return (
      <div className="flex-1 h-full flex flex-col relative bg-[#090c10] overflow-hidden">
        {/* Top Status Bar Indicator for the active pane */}
        <div className="h-6 bg-[#0c1017] border-b border-[#182330] flex items-center justify-between px-3 text-[11px] text-gray-400 select-none">
          <div className="flex items-center gap-2 truncate">
            {isLocalhost ? (
              <span className="flex items-center gap-1 text-purple-400 font-mono">
                <Server className="w-3 h-3" />
                {tab.url}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-cyan-400 truncate">
                <Globe className="w-3 h-3" />
                {tab.url}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isYouTube && (
              <span className="flex items-center gap-1 text-red-400">
                <Video className="w-3 h-3" />
                Hardware Video Stream
              </span>
            )}
            {vramSaverActive && (
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                VRAM Saver Armed
              </span>
            )}
            <span className="text-gray-500 font-mono">
              {isTauri ? 'Native WebView2' : 'Vite Development Mode'}
            </span>
          </div>
        </div>

        {/* Browser Content Area */}
        <div className="flex-1 w-full h-full relative">
          {isTauri ? (
            /* In native Tauri v2, the native webview is attached over this area by Tauri's window manager */
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-gray-400">
              <div className="p-4 rounded-xl bg-[#111822] border border-[#202e3b] max-w-md text-center shadow-lg">
                <div className="w-12 h-12 rounded-full bg-purple-950/60 border border-purple-700/50 flex items-center justify-center mx-auto mb-3">
                  <Server className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-100 mb-1">Native Chromium View Active</h3>
                <p className="text-xs text-gray-400 mb-3">
                  Rendering {tab.url} via system WebView2 with full WebGPU, WebGL, and video acceleration.
                </p>
                <div className="text-[11px] text-gray-500 font-mono bg-[#090c10] p-2 rounded border border-[#1a2533]">
                  URL: {tab.url}
                </div>
              </div>
            </div>
          ) : (
            /* In Browser/Vite Dev Mode: Provide seamless iframe loading with helpful fallback */
            <div className="w-full h-full flex flex-col">
              <iframe
                key={tab.url}
                src={tab.url}
                title={tab.title}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; camera; microphone"
                className="w-full h-full border-0 bg-white"
                onError={(e) => console.log('Iframe load error (expected for cross-origin sites in dev preview)', e)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 w-full h-full flex overflow-hidden">
      {/* Primary Tab Viewport */}
      <div className={`h-full ${isSplitActive ? 'w-1/2 border-r border-[#1f2937]' : 'w-full'}`}>
        {renderTabContent(activeTab)}
      </div>

      {/* Split Tab Viewport (Side-by-side) */}
      {isSplitActive && splitTab && (
        <div className="h-full w-1/2">
          {renderTabContent(splitTab, true)}
        </div>
      )}
    </div>
  );
};
