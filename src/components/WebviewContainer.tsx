import React, { useState } from 'react';
import { Tab } from '../types/browser';
import { Globe, Server, ShieldCheck, Video, ExternalLink, RotateCw } from 'lucide-react';

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
  const [reloadKey, setReloadKey] = useState<number>(0);

  const handleOpenExternal = async (url: string) => {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const renderTabContent = (tab: Tab, _isSplitPane = false) => {
    const isLocalhost = tab.url.includes('localhost') || tab.url.includes('127.0.0.1');
    const isYouTube = tab.url.includes('youtube.com') || tab.url.includes('youtu.be');

    return (
      <div className="flex-1 h-full flex flex-col relative bg-[#090c10] overflow-hidden">
        {/* Top Status Bar Indicator */}
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

          <div className="flex items-center gap-2 shrink-0">
            {isYouTube && (
              <span className="flex items-center gap-1 text-red-400">
                <Video className="w-3 h-3" />
                Hardware Video
              </span>
            )}
            {vramSaverActive && (
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                VRAM Saver
              </span>
            )}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="p-0.5 hover:text-gray-200 transition-colors"
              title="Reload frame"
            >
              <RotateCw className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => handleOpenExternal(tab.url)}
              className="p-0.5 hover:text-gray-200 transition-colors"
              title="Open in system browser"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>

        {/* Live Browser Viewport */}
        <div className="flex-1 w-full h-full relative bg-white">
          <iframe
            key={`${tab.id}-${reloadKey}`}
            src={tab.url}
            title={tab.title}
            className="w-full h-full border-0 bg-white"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; camera; microphone; display-capture; fullscreen"
            allowFullScreen
          />
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
