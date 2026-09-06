import React, { useState, useEffect, useCallback } from 'react';
import { Tab } from './types/browser';
import { TabBar } from './components/TabBar';
import { NavigationBar } from './components/NavigationBar';
import { LocalhostDock } from './components/LocalhostDock';
import { WebviewContainer } from './components/WebviewContainer';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const INITIAL_TABS: Tab[] = [
  {
    id: 'tab-1',
    title: 'Google',
    url: 'https://www.google.com',
    inputUrl: 'https://www.google.com',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  },
];

export function App() {
  const [tabs, setTabs] = useState<Tab[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [splitTabId, setSplitTabId] = useState<string>('');
  const [isSplitActive, setIsSplitActive] = useState<boolean>(false);
  const [vramSaverActive, setVramSaverActive] = useState<boolean>(true);
  const [showAiDock, setShowAiDock] = useState<boolean>(false);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const splitTab = tabs.find((t) => t.id === splitTabId);

  // Tab select handler
  const handleSelectTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return;
      setActiveTabId(id);
      const targetTab = tabs.find((t) => t.id === id);
      if (targetTab && isTauri) {
        invoke('navigate_browser_view', { url: targetTab.url }).catch(console.error);
      }
    },
    [activeTabId, tabs, isTauri]
  );

  // New Tab handler
  const handleNewTab = useCallback(
    (defaultUrl = 'https://www.google.com') => {
      const newId = `tab-${Date.now()}`;
      const isAi = defaultUrl.includes('localhost') || defaultUrl.includes('127.0.0.1');
      const newTab: Tab = {
        id: newId,
        title: isAi ? 'AI Server' : defaultUrl === 'https://www.google.com' ? 'Google' : 'New Tab',
        url: defaultUrl,
        inputUrl: defaultUrl,
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
        isAiServer: isAi,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
      if (isTauri) {
        invoke('navigate_browser_view', { url: defaultUrl }).catch(console.error);
      }
    },
    [isTauri]
  );

  // Close Tab handler
  const handleCloseTab = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // Keep at least one tab
        const nextTabs = prev.filter((t) => t.id !== id);
        if (id === activeTabId) {
          const nextActive = nextTabs[nextTabs.length - 1];
          setActiveTabId(nextActive.id);
          if (isTauri) {
            invoke('navigate_browser_view', { url: nextActive.url }).catch(console.error);
          }
        }
        return nextTabs;
      });
    },
    [activeTabId, isTauri]
  );

  // Navigate Tab URL
  const handleNavigate = useCallback(
    (newUrl: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === activeTabId) {
            const isAi = newUrl.includes('localhost') || newUrl.includes('127.0.0.1');
            return {
              ...t,
              url: newUrl,
              inputUrl: newUrl,
              title: isAi
                ? `Server (${newUrl.replace(/https?:\/\//, '')})`
                : newUrl.includes('google.com')
                ? 'Google'
                : newUrl,
              isLoading: true,
            };
          }
          return t;
        })
      );
      if (isTauri) {
        invoke('navigate_browser_view', { url: newUrl }).catch(console.error);
      }
    },
    [activeTabId, isTauri]
  );

  // Reload handler
  const handleReload = useCallback(async () => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t))
    );
    try {
      await invoke('reload_browser_view');
    } catch (err) {
      console.error('Reload error, fallback to navigate:', err);
      handleNavigate(activeTab.url);
    }
  }, [activeTabId, activeTab.url, handleNavigate]);

  // Back handler
  const handleGoBack = useCallback(async () => {
    try {
      await invoke('go_back_browser_view');
    } catch (err) {
      console.error('Go back error:', err);
    }
  }, []);

  // Forward handler
  const handleGoForward = useCallback(async () => {
    try {
      await invoke('go_forward_browser_view');
    } catch (err) {
      console.error('Go forward error:', err);
    }
  }, []);

  // Open server from dock
  const handleOpenServer = useCallback((url: string, newTab = false) => {
    if (newTab) {
      handleNewTab(url);
    } else {
      handleNavigate(url);
    }
  }, [handleNewTab, handleNavigate]);

  // Listen for backend webview navigation & loading status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    listen<{
      url?: string;
      title?: string;
      isLoading?: boolean;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }>('webview-status', (event) => {
      const payload = event.payload;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === activeTabId) {
            const newUrl =
              payload.url && !payload.url.startsWith('data:text/html')
                ? payload.url
                : t.url;
            let newTitle = t.title;
            if (payload.title && !payload.title.includes('AuraView')) {
              newTitle = payload.title;
            } else if (newUrl !== t.url) {
              newTitle = newUrl.includes('google.com') ? 'Google' : newUrl;
            }

            return {
              ...t,
              url: newUrl,
              inputUrl: newUrl,
              title: newTitle,
              isLoading: payload.isLoading !== undefined ? payload.isLoading : t.isLoading,
              canGoBack: payload.canGoBack !== undefined ? payload.canGoBack : true,
              canGoForward: payload.canGoForward !== undefined ? payload.canGoForward : true,
            };
          }
          return t;
        })
      );
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [activeTabId]);

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
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          handleReload();
        } else if (e.key === '\\') {
          e.preventDefault();
          setIsSplitActive((prev) => !prev);
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setShowAiDock((prev) => !prev);
        }
      } else if (e.key === 'F5') {
        e.preventDefault();
        handleReload();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, handleNewTab, handleCloseTab, handleReload]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090c10] text-[#e4e7eb] overflow-hidden select-none">
      {/* 1. Top Tab Strip */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={() => handleNewTab()}
      />

      {/* 2. Navigation Bar */}
      <NavigationBar
        url={activeTab?.url || ''}
        isLoading={activeTab?.isLoading || false}
        canGoBack={activeTab?.canGoBack !== false}
        canGoForward={activeTab?.canGoForward !== false}
        isSplitActive={isSplitActive}
        vramSaverActive={vramSaverActive}
        showAiDock={showAiDock}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onGoHome={() => handleNavigate('https://www.google.com')}
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
        showAiDock={showAiDock}
      />
    </div>
  );
}

export default App;
