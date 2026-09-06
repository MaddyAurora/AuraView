import React, { useEffect } from 'react';
import { Tab } from '../types/browser';
import { Globe, Server } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface WebviewContainerProps {
  activeTab: Tab;
  splitTab?: Tab;
  isSplitActive: boolean;
  vramSaverActive: boolean;
  showAiDock: boolean;
}

export const WebviewContainer: React.FC<WebviewContainerProps> = ({
  activeTab,
  splitTab,
  isSplitActive,
  showAiDock,
}) => {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return;

    const updateBounds = async () => {
      let x = 0;
      let y = showAiDock ? 118 : 80;
      let width = window.innerWidth;
      let height = Math.max(100, window.innerHeight - y);

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          x = rect.left;
          y = rect.top;
          width = rect.width;
          height = rect.height;
        }
      }

      try {
        await invoke('update_browser_bounds', {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height),
        });
      } catch (err) {
        console.error('Resize error:', err);
      }
    };

    updateBounds();

    window.addEventListener('resize', updateBounds);
    const timer = setTimeout(updateBounds, 50);

    return () => {
      window.removeEventListener('resize', updateBounds);
      clearTimeout(timer);
    };
  }, [showAiDock, isTauri]);

  // If in browser dev preview mode
  if (!isTauri) {
    return (
      <div className="flex-1 w-full h-full flex overflow-hidden bg-[#090c10]">
        <div className={`h-full ${isSplitActive ? 'w-1/2 border-r border-[#1f2937]' : 'w-full'}`}>
          <iframe
            key={activeTab.url}
            src={activeTab.url}
            title={activeTab.title}
            className="w-full h-full border-0 bg-white"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; camera; microphone; display-capture; fullscreen"
            allowFullScreen
          />
        </div>
        {isSplitActive && splitTab && (
          <div className="h-full w-1/2">
            <iframe
              key={splitTab.url}
              src={splitTab.url}
              title={splitTab.title}
              className="w-full h-full border-0 bg-white"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; camera; microphone; display-capture; fullscreen"
              allowFullScreen
            />
          </div>
        )}
      </div>
    );
  }

  // In native Tauri mode, the child WebView2 surface is positioned directly over this area
  return (
    <div ref={containerRef} className="flex-1 w-full h-full flex bg-[#090c10] relative">
      <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 select-none pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
          {activeTab.isAiServer ? <Server className="w-4 h-4 text-purple-500" /> : <Globe className="w-4 h-4 text-cyan-500" />}
          <span>Connecting to {activeTab.url}...</span>
        </div>
      </div>
    </div>
  );
};
