import React from 'react';
import { Columns, Layers } from 'lucide-react';
import { AddressBar, AddressBarProps } from './AddressBar';

interface NavigationBarProps extends AddressBarProps {
  isSplitActive: boolean;
  showAiDock: boolean;
  onToggleSplit: () => void;
  onToggleAiDock: () => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({ isSplitActive, showAiDock,
  onToggleSplit, onToggleAiDock, ...addressProps }) => (
  <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 bg-[#151e28] border-b border-[#1f2937] text-gray-300 text-xs select-none">
    {isSplitActive ? <span className="flex-1 text-gray-400">Split view <span className="text-gray-500">— AI Dock opens in the left pane</span></span> : <AddressBar {...addressProps} />}
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={onToggleAiDock} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${showAiDock ? 'bg-purple-950/80 text-purple-300 border-purple-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`} title="Toggle Localhost AI Servers Dock" aria-pressed={showAiDock}>
        <Layers className="w-3.5 h-3.5 text-purple-400" /><span>AI Dock</span>
      </button>
      <button onClick={onToggleSplit} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${isSplitActive ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60' : 'bg-[#0f141b] text-gray-400 border-[#202e3b] hover:text-gray-200 hover:bg-[#1a232f]'}`} title={isSplitActive ? 'Close split view (Ctrl+\\)' : 'Split view (Ctrl+\\)'} aria-pressed={isSplitActive}>
        <Columns className="w-3.5 h-3.5 text-cyan-400" /><span>{isSplitActive ? 'Close Split' : 'Split'}</span>
      </button>
    </div>
  </div>
);
