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

  // Coordinate native child Webviews via Tauri IPC
  useEffect(() => {
    if (!isTauri) return;

    const topBarHeight = showAiDock ? 118 : 80;
    const width = window.innerWidth;
    const height = Math.max(100, window.innerHeight - topBarHeight);

    const updateWebviews = async () => {
      try {
        if (isSplitActive && splitTab) {
          const halfWidth = width / 2.0;
          await invoke('navigate_browser_view', {
            url: activeTab.url,
            x: 0.0,
            y: Number(topBarHeight),
            width: halfWidth,
            height: Number(height),
          });
          await invoke('navigate_split_view', {
            url: splitTab.url,
            x: halfWidth,
            y: Number(topBarHeight),
            width: halfWidth,
            height: Number(height),
          });
        } else {
          await invoke('navigate_browser_view', {
            url: activeTab.url,
            x: 0.0,
            y: Number(topBarHeight),
            width: Number(width),
            height: Number(height),
          });
          await invoke('close_split_view');
        }
      } catch (err) {
        console.error('Tauri webview navigation error:', err);
      }
    };

    updateWebviews();

    const handleResize = async () => {
      try {
        const newWidth = window.innerWidth;
        const newHeight = Math.max(100, window.innerHeight - topBarHeight);
        await invoke('update_browser_bounds', {
          x: 0.0,
          y: Number(topBarHeight),
          width: Number(newWidth),
          height: Number(newHeight),
          splitActive: isSplitActive,
        });
      } catch (err) {
        console.error('Resize error:', err);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab.url, splitTab?.url, isSplitActive, showAiDock, isTauri]);

  // If in standard web development mode (e.g. previewing via Vite in a browser)
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
    <div className="flex-1 w-full h-full flex bg-[#090c10] relative">
      {/* Background canvas while webview loads */}
      <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 select-none pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
          {activeTab.isAiServer ? <Server className="w-4 h-4 text-purple-500" /> : <Globe className="w-4 h-4 text-cyan-500" />}
          <span>Connecting to {activeTab.url}...</span>
        </div>
      </div>
    </div>
  );
};
