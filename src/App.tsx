import React, { useState, useEffect, useCallback } from 'react';
import { Tab } from './types/browser';
import { TabBar } from './components/TabBar';
import { NavigationBar } from './components/NavigationBar';
import { LocalhostDock } from './components/LocalhostDock';
import { WebviewContainer } from './components/WebviewContainer';

const INITIAL_TABS: Tab[] = [
  {
    id: 'tab-1',
    title: 'ComfyUI (8188)',
    url: 'http://localhost:8188',
    inputUrl: 'http://localhost:8188',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isAiServer: true,
  },
  {
    id: 'tab-2',
    title: 'YouTube',
    url: 'https://www.youtube.com',
    inputUrl: 'https://www.youtube.com',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  },
];

export function App() {
  const [tabs, setTabs] = useState<Tab[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [splitTabId, setSplitTabId] = useState<string>('tab-2');
  const [isSplitActive, setIsSplitActive] = useState<boolean>(false);
  const [vramSaverActive, setVramSaverActive] = useState<boolean>(true);
  const [showAiDock, setShowAiDock] = useState<boolean>(true);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const splitTab = tabs.find((t) => t.id === splitTabId);

  // New Tab handler
  const handleNewTab = useCallback((defaultUrl = 'https://duckduckgo.com') => {
    const newId = `tab-${Date.now()}`;
    const isAi = defaultUrl.includes('localhost') || defaultUrl.includes('127.0.0.1');
    const newTab: Tab = {
      id: newId,
      title: isAi ? 'AI Server' : 'New Tab',
      url: defaultUrl,
      inputUrl: defaultUrl,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isAiServer: isAi,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, []);

  // Close Tab handler
  const handleCloseTab = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // Keep at least one tab
      const nextTabs = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        const nextActive = nextTabs[nextTabs.length - 1];
        setActiveTabId(nextActive.id);
      }
      return nextTabs;
    });
  }, [activeTabId]);

  // Navigate Tab URL
  const handleNavigate = useCallback((newUrl: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === activeTabId) {
          const isAi = newUrl.includes('localhost') || newUrl.includes('127.0.0.1');
          return {
            ...t,
            url: newUrl,
            inputUrl: newUrl,
            title: isAi ? `Server (${newUrl.replace(/https?:\/\//, '')})` : newUrl,
            isLoading: false,
          };
        }
        return t;
      })
    );
  }, [activeTabId]);

  // Open server from dock
  const handleOpenServer = useCallback((url: string, newTab = false) => {
    if (newTab) {
      handleNewTab(url);
    } else {
      handleNavigate(url);
    }
  }, [handleNewTab, handleNavigate]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          handleNewTab();
        } else if (e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          handleCloseTab(activeTabId);
        } else if (e.key === '\\') {
          e.preventDefault();
          setIsSplitActive((prev) => !prev);
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setShowAiDock((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, handleNewTab, handleCloseTab]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090c10] text-[#e4e7eb] overflow-hidden select-none">
      {/* 1. Top Tab Strip */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={() => handleNewTab()}
      />

      {/* 2. Navigation Bar */}
      <NavigationBar
        url={activeTab?.url || ''}
        canGoBack={activeTab?.canGoBack || false}
        canGoForward={activeTab?.canGoForward || false}
        isSplitActive={isSplitActive}
        vramSaverActive={vramSaverActive}
        showAiDock={showAiDock}
        onNavigate={handleNavigate}
        onGoBack={() => console.log('Back')}
        onGoForward={() => console.log('Forward')}
        onReload={() => {
          const currentUrl = activeTab.url;
          handleNavigate(currentUrl);
        }}
        onGoHome={() => handleNavigate('http://localhost:8188')}
        onToggleSplit={() => {
          if (!isSplitActive && tabs.length > 1) {
            const otherTab = tabs.find((t) => t.id !== activeTabId);
            if (otherTab) setSplitTabId(otherTab.id);
          }
          setIsSplitActive(!isSplitActive);
        }}
        onToggleVramSaver={() => setVramSaverActive(!vramSaverActive)}
        onToggleAiDock={() => setShowAiDock(!showAiDock)}
      />

      {/* 3. Localhost AI Servers Dock */}
      {showAiDock && <LocalhostDock onOpenServer={handleOpenServer} />}

      {/* 4. Browser Webview Viewport */}
      <WebviewContainer
        activeTab={activeTab}
        splitTab={splitTab}
        isSplitActive={isSplitActive}
        vramSaverActive={vramSaverActive}
      />
    </div>
  );
}

export default App;
