import React, { useState } from 'react';
import { DEFAULT_AI_SERVERS, AIServerBookmark } from '../types/browser';
import { ExternalLink, Plus, Zap } from 'lucide-react';

interface LocalhostDockProps {
  onOpenServer: (url: string, newTab?: boolean) => void;
}

export const LocalhostDock: React.FC<LocalhostDockProps> = ({ onOpenServer }) => {
  const [customPort, setCustomPort] = useState('');
  const [servers] = useState<AIServerBookmark[]>(DEFAULT_AI_SERVERS);

  const handleLaunchCustomPort = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(customPort.trim(), 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) return;

    const newUrl = `http://localhost:${portNum}`;
    onOpenServer(newUrl, true);
    setCustomPort('');
  };

  return (
    <div className="bg-[#0c1017] border-b border-[#1a2533] px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs select-none">
      {/* Quick Launch Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-gray-400 font-semibold uppercase text-[10px] tracking-wider mr-1">
          <Zap className="w-3 h-3 text-purple-400" />
          <span>Local AI Hub:</span>
        </div>

        {servers.map((server) => (
          <div
            key={server.id}
            onClick={() => onOpenServer(`http://localhost:${server.port}`)}
            className="group flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#131b26] hover:bg-[#1a2533] border border-[#233346] hover:border-purple-500/60 cursor-pointer transition-all shadow-sm"
            title={`${server.description} (http://localhost:${server.port})`}
          >
            <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${server.color}`} />
            <span className="font-medium text-gray-200 group-hover:text-white">
              {server.name}
            </span>
            <span className="text-[10px] text-gray-500 group-hover:text-purple-400 font-mono">
              :{server.port}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenServer(`http://localhost:${server.port}`, true);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200 transition-opacity"
              title="Open in new tab"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Quick Port Jump */}
      <form onSubmit={handleLaunchCustomPort} className="flex items-center gap-1.5">
        <div className="relative flex items-center">
          <span className="absolute left-2 text-gray-500 font-mono text-[11px]">:</span>
          <input
            type="number"
            value={customPort}
            onChange={(e) => setCustomPort(e.target.value)}
            placeholder="Port..."
            min="1"
            max="65535"
            className="w-20 pl-4 pr-2 py-1 rounded bg-[#131b26] border border-[#233346] text-gray-200 text-xs focus:outline-none focus:border-purple-500 font-mono placeholder-gray-600"
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
    </div>
  );
};
