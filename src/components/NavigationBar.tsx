import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Lock,
  Server,
  Columns,
  Cpu,
  Layers,
  Search,
} from 'lucide-react';

interface NavigationBarProps {
  url: string;
  isLoading?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isSplitActive: boolean;
  vramSaverActive: boolean;
  showAiDock: boolean;
  onNavigate: (newUrl: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  onToggleSplit: () => void;
  onToggleVramSaver: () => void;
  onToggleAiDock: () => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  url,
  isLoading,
  canGoBack,
  canGoForward,
  isSplitActive,
  vramSaverActive,
  showAiDock,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  onToggleSplit,
  onToggleVramSaver,
  onToggleAiDock,
}) => {
  const [inputValue, setInputValue] = useState(url);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(url);
    }
  }, [url, isFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputValue.trim();
    if (!target) return;

    // Check if input is just a port number (e.g., 8188, 7860, 3000)
    if (/^\d{2,5}$/.test(target)) {
      target = `http://localhost:${target}`;
    }
    // Check if input starts with localhost or 127.0.0.1 without protocol
    else if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(target)) {
      target = `http://${target}`;
    }
    // Check if it already has a protocol
    else if (!/^https?:\/\//i.test(target)) {
      // If it looks like a domain name (contains dot and no spaces)
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(target)) {
        target = `https://${target}`;
      } else {
        // Fallback to Google search query
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }

    onNavigate(target);
  };

  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
  const isHttps = url.startsWith('https://');

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#151e28] border-b border-[#1f2937] text-gray-300 text-xs select-none">
      {/* Navigation Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onGoBack}
          disabled={!canGoBack}
          className="p-1.5 rounded-md hover:bg-[#202e3b] disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-400 hover:text-gray-100"
          title="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onGoForward}
          disabled={!canGoForward}
          className="p-1.5 rounded-md hover:bg-[#202e3b] disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-400 hover:text-gray-100"
          title="Forward"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onReload}
          className="p-1.5 rounded-md hover:bg-[#202e3b] transition-colors text-gray-400 hover:text-gray-100"
          title="Reload (Ctrl+R)"
        >
          <RotateCw className={`w-3.5 h-3.5 transition-transform ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
        </button>
        <button
          onClick={onGoHome}
          className="p-1.5 rounded-md hover:bg-[#202e3b] transition-colors text-gray-400 hover:text-gray-100"
          title="Home"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Address & Search Bar */}
      <form onSubmit={handleSubmit} className="flex-1 flex items-center">
        <div className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0a0e14] border border-[#263545] focus-within:border-purple-500/80 focus-within:ring-1 focus-within:ring-purple-500/50 transition-all">
          {/* Protocol Badge */}
          {isLocalhost ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-purple-400 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/50 shrink-0">
              <Server className="w-3 h-3 text-purple-400" />
              AI Local
            </span>
          ) : isHttps ? (
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
          ) : (
            <Search className="w-3 h-3 text-gray-500 shrink-0" />
          )}

          {/* URL Input */}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={(e) => {
              setIsFocused(true);
              e.target.select();
            }}
            onBlur={() => setIsFocused(false)}
            placeholder="Enter AI port (e.g. 8188), URL (youtube.com), or search..."
            className="w-full bg-transparent text-gray-100 text-xs focus:outline-none placeholder-gray-500"
          />
        </div>
      </form>

      {/* Custom AI Controls & Tools */}
      <div className="flex items-center gap-1">
        {/* Local AI Dock Toggle */}
        <button
          onClick={onToggleAiDock}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
            showAiDock
              ? 'bg-purple-950/80 text-purple-300 border-purple-700/60'
              : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'
          }`}
          title="Toggle Localhost AI Servers Dock"
        >
          <Layers className="w-3.5 h-3.5 text-purple-400" />
          <span>AI Dock</span>
        </button>

        {/* Split-View Toggle */}
        <button
          onClick={onToggleSplit}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
            isSplitActive
              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60'
              : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'
          }`}
          title="Split View (Side-by-side servers)"
        >
          <Columns className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Split</span>
        </button>

        {/* VRAM / GPU Saver Mode */}
        <button
          onClick={onToggleVramSaver}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
            vramSaverActive
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 shadow-sm shadow-emerald-900/30'
              : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'
          }`}
          title={vramSaverActive ? 'VRAM Saver Active (Throttling idle webviews)' : 'Enable VRAM Saver'}
        >
          <Cpu className={`w-3.5 h-3.5 ${vramSaverActive ? 'text-emerald-400' : 'text-gray-400'}`} />
          <span className="hidden md:inline">VRAM Saver</span>
        </button>
      </div>
    </div>
  );
};
