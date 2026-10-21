import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserPane, BrowserViewRef } from './types/browser';
import { shortcutAction, ShortcutAction, spaceUsesControl } from './lib/shortcuts';
import { BrowserStatus } from './lib/browserStatus';
import { addTab, applyTabStatus, BrowserSession, closeTab, closeTabPage, createTab, moveTab, orderedTabPages, reopenTab, resizeTabSplit, selectTab, switchTab, swapTabPages, tabPageView, tabViews, toggleSessionSplit } from './lib/tabState';
import { TabBar } from './components/TabBar';
import { NavigationBar } from './components/NavigationBar';
import { LocalhostDock } from './components/LocalhostDock';
import { WebviewContainer } from './components/WebviewContainer';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const INITIAL_TAB = { ...createTab('tab-1'), isLoading: false };

export function App() {
  const [session, setSession] = useState<BrowserSession>({ tabs: [INITIAL_TAB], activeTabId: INITIAL_TAB.id });
  const [showAiDock, setShowAiDock] = useState(false);
  const { tabs, activeTabId } = session;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const { pane: firstPane, page: firstPage } = orderedTabPages(activeTab)[0];
  const isSplitActive = Boolean(activeTab.splitEnabled && activeTab.split);
  const isTauri = '__TAURI_INTERNALS__' in window;
  const focusedView = useRef<BrowserViewRef | undefined>();

  const updateStatus = useCallback((status: BrowserStatus) => {
    setSession((previous) => ({ ...previous, tabs: applyTabStatus(previous.tabs, status) }));
  }, []);

  const handleSelectTab = useCallback((id: string) => {
    setSession((previous) => selectTab(previous, id));
  }, []);

  const handleMoveTab = useCallback((id: string, toIndex: number) => {
    setSession((previous) => moveTab(previous, id, toIndex));
  }, []);

  const handleNewTab = useCallback((url = 'https://www.google.com') => {
    const tab = createTab(`tab-${crypto.randomUUID()}`, url);
    setSession((previous) => addTab(previous, tab));
  }, []);

  const handleCloseTab = useCallback((id: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const tab = tabs.find((item) => item.id === id);
    if (tabs.length <= 1 || !tab) return;
    setSession((previous) => closeTab(previous, id));
    if (isTauri) invoke('close_browser_views', { views: tabViews(tab) }).catch(console.error);
  }, [tabs, isTauri]);

  const handleCloseTabPage = useCallback((id: string, pane: BrowserPane, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const tab = tabs.find((item) => item.id === id);
    if (!tab?.splitEnabled || !tab.split) { handleCloseTab(id); return; }
    setSession((previous) => closeTabPage(previous, id, pane));
    if (isTauri) invoke('close_browser_views', { views: [tabPageView(tab, pane)] }).catch(console.error);
  }, [tabs, isTauri, handleCloseTab]);

  const handleToggleSplit = useCallback(() => {
    setSession(toggleSessionSplit);
  }, []);

  const handleSwapTabPages = useCallback((id: string) => {
    setSession((previous) => ({ ...previous, activeTabId: id,
      tabs: previous.tabs.map((tab) => tab.id === id ? swapTabPages(tab) : tab) }));
  }, []);

  const handleSplitResize = useCallback((id: string, ratio: number) => {
    setSession((previous) => {
      const tab = previous.tabs.find((item) => item.id === id);
      if (!tab) return previous;
      const resized = resizeTabSplit(tab, ratio);
      return resized === tab ? previous : { ...previous,
        tabs: previous.tabs.map((item) => item.id === id ? resized : item) };
    });
  }, []);

  const handlePaneNavigate = useCallback((pane: BrowserPane, url: string) => {
    const view = tabPageView(activeTab, pane);
    updateStatus({ ...view, url, isLoading: true });
    if (isTauri) invoke('navigate_browser_view', { ...view, url }).catch((error) => {
      console.error('Navigation error:', error);
      updateStatus({ ...view, isLoading: false });
    });
  }, [activeTab, isTauri, updateStatus]);

  const handlePaneAction = useCallback(async (pane: BrowserPane, action: 'reload' | 'back' | 'forward') => {
    const view = tabPageView(activeTab, pane);
    if (!isTauri) return;
    if (action === 'reload') updateStatus({ ...view, isLoading: true });
    const command = { reload: 'reload_browser_view', back: 'go_back_browser_view', forward: 'go_forward_browser_view' }[action];
    try { await invoke(command, { ...view }); }
    catch (error) {
      console.error('Navigation action error:', error);
      updateStatus({ ...view, isLoading: false });
    }
  }, [activeTab, isTauri, updateStatus]);

  const handleOpenServer = useCallback((url: string, newTab = false) => {
    if (newTab) handleNewTab(url);
    else handlePaneNavigate(firstPane, url);
  }, [handleNewTab, handlePaneNavigate, firstPane]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<BrowserStatus>('webview-status', (event) => {
      if (!disposed) updateStatus({ ...event.payload, tabId: event.payload.tabId || 'tab-1' });
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, [isTauri, updateStatus]);

  const runShortcut = useCallback((action: ShortcutAction, source?: BrowserViewRef) => {
    if (action === 'new-tab') { handleNewTab(); return; }
    if (action === 'close-tab') { handleCloseTab(activeTabId); return; }
    if (action === 'reopen-tab') { setSession(reopenTab); return; }
    if (action === 'next-tab' || action === 'previous-tab') {
      setSession((previous) => switchTab(previous, action === 'next-tab' ? 1 : -1)); return;
    }
    if (action.startsWith('tab-')) {
      const number = Number(action.slice(4));
      setSession((previous) => {
        const tab = previous.tabs[number === 9 ? previous.tabs.length - 1 : number - 1];
        return tab ? selectTab(previous, tab.id) : previous;
      });
      return;
    }
    if (action === 'split') { handleToggleSplit(); return; }
    if (action === 'ai-dock') { setShowAiDock((previous) => !previous); return; }
    const visibleViews = isSplitActive ? tabViews(activeTab) : [tabPageView(activeTab, firstPane)];
    const candidate = source || focusedView.current;
    const view = visibleViews.find((item) => item.tabId === candidate?.tabId && item.pane === candidate.pane)
      || tabPageView(activeTab, firstPane);
    if (!isTauri) return;
    if (action === 'reload') {
      updateStatus({ ...view, isLoading: true });
      invoke('reload_browser_view', { ...view }).catch((error) => {
        console.error(error); updateStatus({ ...view, isLoading: false });
      });
    } else {
      invoke('browser_page_action', { ...view, action }).catch(console.error);
    }
  }, [activeTab, activeTabId, firstPane, isSplitActive, isTauri, handleNewTab, handleCloseTab, handleToggleSplit, updateStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const action = shortcutAction(event);
      if (!action || ((action === 'scroll-up' || action === 'scroll-down') && spaceUsesControl(event.target))) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runShortcut]);

  const shortcutHandler = useRef(runShortcut);
  shortcutHandler.current = runShortcut;
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => {
      if (disposed) stop(); else stops.push(stop);
    };
    listen<{ action: ShortcutAction; view?: BrowserViewRef }>('browser-shortcut', (event) => {
      shortcutHandler.current(event.payload.action, event.payload.view);
    }).then(retain).catch(console.error);
    listen<BrowserViewRef>('browser-focus', (event) => {
      focusedView.current = event.payload;
    }).then(retain).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [isTauri]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090c10] text-[#e4e7eb] overflow-hidden select-none">
      <TabBar tabs={tabs} activeTabId={activeTabId} onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab} onCloseTabPage={handleCloseTabPage} onNewTab={() => handleNewTab()} onSwapTabPages={handleSwapTabPages}
        onMoveTab={handleMoveTab} />
      <NavigationBar key={`${activeTabId}:${firstPane}`} url={firstPage.url} isLoading={firstPage.isLoading}
        canGoBack={firstPage.canGoBack} canGoForward={firstPage.canGoForward}
        isSplitActive={isSplitActive} showAiDock={showAiDock}
        onNavigate={(url) => handlePaneNavigate(firstPane, url)}
        onGoBack={() => { void handlePaneAction(firstPane, 'back'); }}
        onGoForward={() => { void handlePaneAction(firstPane, 'forward'); }}
        onReload={() => { void handlePaneAction(firstPane, 'reload'); }}
        onGoHome={() => handlePaneNavigate(firstPane, 'https://www.google.com')}
        onToggleSplit={handleToggleSplit} onToggleAiDock={() => setShowAiDock((previous) => !previous)} />
      {showAiDock && <LocalhostDock onOpenServer={handleOpenServer} />}
      <WebviewContainer activeTab={activeTab} splitTab={activeTab.split || INITIAL_TAB}
        onSplitResize={handleSplitResize}
        isSplitActive={isSplitActive} showAiDock={showAiDock} onNavigate={handlePaneNavigate}
        onReload={(pane) => { void handlePaneAction(pane, 'reload'); }}
        onGoBack={(pane) => { void handlePaneAction(pane, 'back'); }}
        onGoForward={(pane) => { void handlePaneAction(pane, 'forward'); }}
        onPreviewLoad={(pane) => updateStatus({ ...tabPageView(activeTab, pane), isLoading: false })} />
    </div>
  );
}

export default App;
