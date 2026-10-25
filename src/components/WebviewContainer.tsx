import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BrowserPane, BrowserViewRef, Tab } from '../types/browser';
import { AddressBar, AddressFillRequest } from './AddressBar';
import { orderedTabPages, tabPageView } from '../lib/tabState';
import { clampSplitRatio, createLatestTaskRunner } from '../lib/splitResize';
import { SplitDivider } from './SplitDivider';

interface WebviewContainerProps {
  activeTab: Tab;
  splitTab: Tab;
  isSplitActive: boolean;
  showAiDock: boolean;
  focusAddress?: boolean;
  onLayoutReady?: (tabId: string) => void;
  addressFill?: AddressFillRequest & { view: BrowserViewRef };
  onFillApplied?: (id: string) => void;
  onNavigate: (pane: BrowserPane, url: string) => void;
  onReload: (pane: BrowserPane) => void;
  onGoBack: (pane: BrowserPane) => void;
  onGoForward: (pane: BrowserPane) => void;
  onPreviewLoad: (pane: BrowserPane) => void;
  onSplitResize: (tabId: string, ratio: number) => void;
}

export const WebviewContainer: React.FC<WebviewContainerProps> = ({ activeTab, splitTab,
  isSplitActive, showAiDock, focusAddress = false, onLayoutReady, addressFill, onFillApplied, onNavigate, onReload, onGoBack, onGoForward, onPreviewLoad, onSplitResize }) => {
  const isTauri = '__TAURI_INTERNALS__' in window;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(Infinity);
  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const splitUrlRef = useRef(splitTab.url);
  splitUrlRef.current = splitTab.url;
  const primaryUrlRef = useRef(activeTab.url);
  primaryUrlRef.current = activeTab.url;
  const layoutQueue = useRef(createLatestTaskRunner());
  const configuredLayout = useRef('');
  const addressFocusRef = useRef({ tabId: activeTab.id, requested: focusAddress, onLayoutReady });
  addressFocusRef.current = { tabId: activeTab.id, requested: focusAddress, onLayoutReady };
  const [secondaryReady, setSecondaryReady] = useState(!isTauri);
  const [layoutError, setLayoutError] = useState(false);
  const [reloadVersions, setReloadVersions] = useState<Record<string, number>>({});
  const audioRef = useRef({ primaryMuted: Boolean(activeTab.isMuted), secondaryMuted: Boolean(splitTab.isMuted) });
  audioRef.current = { primaryMuted: Boolean(activeTab.isMuted), secondaryMuted: Boolean(splitTab.isMuted) };

  useEffect(() => {
    if (isTauri) return;
    const reload = (event: Event) => {
      const view = (event as CustomEvent<{ tabId: string; pane: BrowserPane }>).detail;
      const key = `${view.tabId}:${view.pane}`;
      setReloadVersions((previous) => ({ ...previous, [key]: (previous[key] || 0) + 1 }));
    };
    window.addEventListener('browser-preview-reload', reload);
    return () => window.removeEventListener('browser-preview-reload', reload);
  }, [isTauri]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setContainerWidth(container.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);
  const ratio = clampSplitRatio(activeTab.splitRatio ?? 0.5, containerWidth);
  const primaryView = tabPageView(activeTab, 'primary');
  const secondaryView = tabPageView(activeTab, 'secondary');

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let frame = 0;
    setSecondaryReady(!isTauri);
    const bounds = (element: HTMLDivElement | null) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return width > 0 && height > 0 ? { x, y, width, height } : null;
    };
    const updateLayout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const primary = bounds(primaryRef.current);
        const secondary = isSplitActive ? bounds(secondaryRef.current) : null;
        if (!primary || (isSplitActive && !secondary)) return;
        const rightUrl = splitUrlRef.current;
        const primaryUrl = primaryUrlRef.current;
        const tabId = activeTab.id;
        const mode = JSON.stringify([tabId, isSplitActive, Boolean(activeTab.splitReversed), primaryView, secondaryView]);
        layoutQueue.current(async () => {
          if (disposed) return;
          try {
            const command = configuredLayout.current === mode ? 'resize_browser_views' : 'configure_browser_views';
            const focusAddress = command === 'configure_browser_views'
              && addressFocusRef.current.tabId === tabId && addressFocusRef.current.requested;
            await invoke(command, { primary, secondary, rightUrl, primaryUrl, tabId, primaryView, secondaryView,
              ...audioRef.current,
              reversed: Boolean(activeTab.splitReversed), focusAddress });
            configuredLayout.current = mode;
            if (!disposed) {
              setSecondaryReady(isSplitActive); setLayoutError(false);
              if (focusAddress) addressFocusRef.current.onLayoutReady?.(tabId);
            }
          } catch (error) {
            configuredLayout.current = '';
            console.error('Browser layout error:', error);
            if (!disposed) setLayoutError(true);
          }
        });
      });
    };
    const observer = new ResizeObserver(updateLayout);
    if (primaryRef.current) observer.observe(primaryRef.current);
    if (secondaryRef.current) observer.observe(secondaryRef.current);
    window.addEventListener('resize', updateLayout);
    updateLayout();
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', updateLayout); };
  }, [isTauri, isSplitActive, showAiDock, activeTab.id, activeTab.splitReversed,
    primaryView.tabId, primaryView.pane, secondaryView.tabId, secondaryView.pane]);

  const renderPane = (pane: BrowserPane, tab: Tab, ref: React.RefObject<HTMLDivElement>, side: 'left' | 'right') => (
    <section key={pane} aria-label={side === 'left' ? 'Left browser pane' : 'Right browser pane'}
      className="flex min-w-0 min-h-0 flex-col basis-0"
      style={{ flexGrow: isSplitActive ? (side === 'left' ? ratio : 1 - ratio) : 1 }}>
      {isSplitActive && <div className="shrink-0 px-2 py-1.5 bg-[#151e28] border-b border-[#1f2937] text-xs">
        <AddressBar key={`${activeTab.id}:${pane}`} label={side === 'left' ? 'Left pane' : 'Right pane'} url={tab.url} isLoading={tab.isLoading}
          fillRequest={addressFill?.view.tabId === tabPageView(activeTab, pane).tabId && addressFill.view.pane === tabPageView(activeTab, pane).pane ? addressFill : undefined}
          onFillApplied={onFillApplied}
          canGoBack={tab.canGoBack} canGoForward={tab.canGoForward} disabled={!secondaryReady}
          onNavigate={(url) => onNavigate(pane, url)} onReload={() => onReload(pane)}
          onGoBack={() => onGoBack(pane)} onGoForward={() => onGoForward(pane)}
          onGoHome={() => onNavigate(pane, 'https://www.google.com')} />
      </div>}
      <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden bg-[#090c10]">
        {isTauri ? <div className="flex h-full items-center justify-center text-gray-500 text-xs pointer-events-none">
          {layoutError ? 'Unable to open the browser pane.' : `Connecting to ${tab.url}...`}
        </div> : <iframe key={`${activeTab.id}:${pane}:${tab.url}:${reloadVersions[`${tabPageView(activeTab, pane).tabId}:${tabPageView(activeTab, pane).pane}`] || 0}`} src={tab.url} title={side === 'left' ? `Left: ${tab.title}` : `Right: ${tab.title}`}
          className="w-full h-full border-0 bg-white" onLoad={() => onPreviewLoad(pane)}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; camera; microphone; display-capture; fullscreen" allowFullScreen />}
      </div>
    </section>
  );
  const pages = orderedTabPages(activeTab);
  return <div ref={containerRef} className="flex flex-1 min-h-0 w-full overflow-hidden">
    {renderPane(pages[0].pane, pages[0].page, primaryRef, 'left')}
    {isSplitActive && pages[1] && <SplitDivider key={`${activeTab.id}:${activeTab.splitReversed}`}
      containerRef={containerRef} ratio={ratio} containerWidth={containerWidth}
      onChange={(next) => onSplitResize(activeTab.id, next)} />}
    {isSplitActive && pages[1] && renderPane(pages[1].pane, pages[1].page, secondaryRef, 'right')}
  </div>;
};
