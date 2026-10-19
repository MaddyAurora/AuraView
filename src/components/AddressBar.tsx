import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Home, Lock, Server, Search } from 'lucide-react';
import { resolveAddress } from '../lib/address';

export interface AddressBarProps {
  url: string;
  isLoading?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  label?: string;
  disabled?: boolean;
}

export function AddressBar({ url, isLoading, canGoBack, canGoForward, onNavigate,
  onGoBack, onGoForward, onReload, onGoHome, label = 'Address', disabled = false }: AddressBarProps) {
  const [inputValue, setInputValue] = useState(url);
  const [isFocused, setIsFocused] = useState(false);
  useEffect(() => { if (!isFocused) setInputValue(url); }, [url, isFocused]);
  const isLocalhost = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);
  const buttonClass = 'p-1.5 rounded-md hover:bg-[#202e3b] disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-400 hover:text-gray-100';
  return (
    <div className="flex flex-1 min-w-0 items-center gap-2">
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onGoBack} disabled={disabled || !canGoBack} className={buttonClass} title="Back" aria-label={`${label}: Back`}><ArrowLeft className="w-3.5 h-3.5" /></button>
        <button onClick={onGoForward} disabled={disabled || !canGoForward} className={buttonClass} title="Forward" aria-label={`${label}: Forward`}><ArrowRight className="w-3.5 h-3.5" /></button>
        <button onClick={onReload} disabled={disabled} className={buttonClass} title="Reload" aria-label={`${label}: Reload`}><RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} /></button>
        <button onClick={onGoHome} disabled={disabled} className={`${buttonClass} hidden lg:block`} title="Home" aria-label={`${label}: Home`}><Home className="w-3.5 h-3.5" /></button>
      </div>
      <form className="flex-1 min-w-0" onSubmit={(event) => {
        event.preventDefault();
        const target = resolveAddress(inputValue);
        if (target && !disabled) onNavigate(target);
      }}>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0a0e14] border border-[#263545] focus-within:border-purple-500/80 focus-within:ring-1 focus-within:ring-purple-500/50">
          {isLocalhost ? <Server className="w-3 h-3 text-purple-400 shrink-0" /> : url.startsWith('https://') ? <Lock className="w-3 h-3 text-emerald-400 shrink-0" /> : <Search className="w-3 h-3 text-gray-500 shrink-0" />}
          <input type="text" aria-label={`${label} URL`} disabled={disabled} value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onFocus={(event) => { setIsFocused(true); event.target.select(); }} onBlur={() => setIsFocused(false)}
            placeholder="Port, URL, or search..." className="w-full min-w-0 bg-transparent text-gray-100 text-xs focus:outline-none placeholder-gray-500" />
        </div>
      </form>
    </div>
  );
}
