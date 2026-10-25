import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserPane, BrowserViewRef } from './types/browser';
import { shortcutAction, ShortcutAction, spaceUsesControl } from './lib/shortcuts';
import { BrowserStatus } from './lib/browserStatus';
import { loadToolbarVisibility, saveToolbarVisibility, TOOLBAR_VISIBILITY_KEY, ToolbarVisibility } from './lib/toolbarVisibility';
import { addTab, applyTabStatus, BrowserSession, closeTab, closeTabPage, closeTabsOnSide, createTab, duplicateTabPage, findTabPage, moveTab, orderedTabPages, reopenTab, resizeTabSplit, selectTab, switchTab, swapTabPages, tabPageView, tabsOnSide, tabViews, toggleSessionSplit } from './lib/tabState';
import { TabMenuAction } from './lib/tabContextMenu';
import { TabBar } from './components/TabBar';
import { NavigationBar } from './components/NavigationBar';
import { AddressFillRequest } from './components/AddressBar';
import { LocalhostDock } from './components/LocalhostDock';
import { BookmarksBar } from './components/BookmarksBar';
import { WebviewContainer } from './components/WebviewContainer';
import { Downloads, useDownloads, useDownloadIndicator } from './components/Downloads';
import { DownloadsPreview } from './components/DownloadsPreview';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const INITIAL_TAB = { ...createTab('tab-1'), isLoading: false };

export function App() {
  const [session, setSession] = useState<BrowserSession>({ tabs: [INITIAL_TAB], activeTabId: INITIAL_TAB.id });
  const [toolbarVisibility, setToolbarVisibility] = useState(() => loadToolbarVisibility(window.localStorage));
  const { showAiDock, showBookmarks } = toolbarVisibility;
  const toolbarVisibilityRef = useRef(toolbarVisibility);
  toolbarVisibilityRef.current = toolbarVisibility;
  const [showDownloads, setShowDownloads] = useState(false);
  const [hoverDownloads, setHoverDownloads] = useState(false);
  const downloadsAnchor = useRef<HTMLDivElement>(null);
  const downloads = useDownloads();
  const downloadIndicator = useDownloadIndicator(downloads);
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const { tabs, activeTabId } = session;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const { pane: firstPane, page: firstPage } = orderedTabPages(activeTab)[0];
  const isSplitActive = Boolean(activeTab.splitEnabled && activeTab.split);
  const isTauri = '__TAURI_INTERNALS__' in window;
  const focusedView = useRef<BrowserViewRef | undefined>();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [addressFill, setAddressFill] = useState<(AddressFillRequest & { view: BrowserViewRef })>();
  const handleFillApplied = useCallback((id: string) => {
    setAddressFill((current) => current?.id === id ? undefined : current);
  }, []);
  const [addressFocusTabId, setAddressFocusTabId] = useState<string | null>(null);
  const handleLayoutReady = useCallback((tabId: string) => {
    setAddressFocusTabId((current) => current === tabId ? null : current);
  }, []);

  const toggleToolbar = useCallback((key: keyof ToolbarVisibility) => {
    const current = toolbarVisibilityRef.current;
    const next = { ...current, [key]: !current[key] };
    try { saveToolbarVisibility(window.localStorage, next); }
    catch { setSettingsError('Unable to save toolbar visibility. Please try again.'); return; }
    toolbarVisibilityRef.current = next;
    setToolbarVisibility(next);
  }, []);

  useEffect(() => {
    const restore = (event: StorageEvent) => {
      if (event.key && event.key !== TOOLBAR_VISIBILITY_KEY) return;
      const next = loadToolbarVisibility(window.localStorage);
      toolbarVisibilityRef.current = next;
      setToolbarVisibility(next);
    };
    window.addEventListener('storage', restore);
    return () => window.removeEventListener('storage', restore);
  }, []);

  useEffect(() => {
    const leave = () => setHoverDownloads(false);
    window.addEventListener('blur', leave);
    return () => window.removeEventListener('blur', leave);
  }, []);

  const updateStatus = useCallback((status: BrowserStatus) => {
    setSession((previous) => ({ ...previous, tabs: applyTabStatus(previous.tabs, status) }));
  }, []);

  const handleSelectTab = useCallback((id: string) => {
    setAddressFocusTabId(null);
    setSession((previous) => selectTab(previous, id));
  }, []);

  const handleMoveTab = useCallback((id: string, toIndex: number) => {
    setSession((previous) => moveTab(previous, id, toIndex));
  }, []);

  const handleNewTab = useCallback((url?: string) => {
    const tab = createTab(`tab-${crypto.randomUUID()}`, url);
    setAddressFocusTabId(url === undefined ? tab.id : null);
    setSession((previous) => addTab(previous, tab));
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    listen<string>('history-open-url', (event) => handleNewTab(event.payload)).then(retain).catch(console.error);
    listen<string>('page-selection-open-url', (event) => handleNewTab(event.payload)).then(retain).catch(console.error);
    listen<{ view: BrowserViewRef; text: string }>('page-selection-fill-address', (event) => {
      const { view, text } = event.payload;
      const owner = sessionRef.current.tabs.find((tab) => (tab.splitEnabled ? tabViews(tab) : [tabPageView(tab, 'primary')])
        .some((candidate) => candidate.tabId === view.tabId && candidate.pane === view.pane));
      if (!owner) return;
      setSession((previous) => selectTab(previous, owner.id));
      setAddressFocusTabId(owner.id);
      setAddressFill({ id: crypto.randomUUID(), view, text });
    }).then(retain).catch(console.error);
    listen<string>('page-selection-error', (event) => setSettingsError(event.payload)).then(retain).catch(console.error);
    listen('browser-history-cleared', () => setSession((previous) => ({ ...previous, closedTabs: [] }))).then(retain).catch(console.error);
    listen<string>('browser-history-error', (event) => setSettingsError(event.payload)).then(retain).catch(console.error);
    void invoke('browser_settings_ready').catch((error) => { if (!disposed) setSettingsError(String(error)); });
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [isTauri, handleNewTab]);

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

  const handleTabMenuAction = useCallback((action: TabMenuAction, pageId: string) => {
    if (action === 'reopen') { setSession(reopenTab); return; }
    // Resolve at selection time: pages may move or detach while a native menu is open.
    const target = findTabPage(tabs, pageId);
    if (!target) return;
    const { owner, page, pane } = target;
    const view = tabPageView(owner, pane);
    if (action === 'close') { handleCloseTabPage(owner.id, pane); return; }
    if (action === 'duplicate') { setSession((previous) => duplicateTabPage(previous, pageId)); return; }
    if (action === 'close-left' || action === 'close-right') {
      const side = action === 'close-left' ? 'left' : 'right';
      const closing = tabsOnSide(tabs, owner.id, side);
      if (!closing.length) return;
      setSession((previous) => closeTabsOnSide(previous, owner.id, side));
      if (isTauri) invoke('close_browser_views', { views: closing.flatMap(tabViews) }).catch(console.error);
      return;
    }
    if (action === 'mute') {
      const isMuted = !page.isMuted;
      updateStatus({ ...view, isMuted });
      if (isTauri) invoke('set_browser_muted', { ...view, muted: isMuted }).catch((error) => {
        console.error('Unable to mute tab:', error);
        updateStatus({ ...view, isMuted: !isMuted });
      });
      return;
    }
    if (action === 'refresh') {
      if (!isTauri) {
        window.dispatchEvent(new CustomEvent('browser-preview-reload', { detail: view }));
        return;
      }
      updateStatus({ ...view, isLoading: true });
      invoke('reload_browser_view', { ...view }).catch((error) => {
        console.error(error); updateStatus({ ...view, isLoading: false });
      });
    }
  }, [tabs, isTauri, handleCloseTabPage, updateStatus]);

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
    setAddressFocusTabId(null);
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

  const bookmarkPage = () => {
    const pages = isSplitActive ? orderedTabPages(activeTab) : orderedTabPages(activeTab).slice(0, 1);
    return pages.find(({ pane }) => {
      const view = tabPageView(activeTab, pane);
      return view.tabId === focusedView.current?.tabId && view.pane === focusedView.current?.pane;
    }) || pages[0];
  };

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
    if (editorOpen) return;
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
    if (action === 'ai-dock') { toggleToolbar('showAiDock'); return; }
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
  }, [activeTab, activeTabId, firstPane, isSplitActive, isTauri, editorOpen, handleNewTab, handleCloseTab, handleToggleSplit, updateStatus, toggleToolbar]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (editorOpen) return;
      const action = shortcutAction(event);
      if (!action || ((action === 'scroll-up' || action === 'scroll-down') && spaceUsesControl(event.target))) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runShortcut, editorOpen]);

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
        onMoveTab={handleMoveTab} canReopenTab={Boolean(session.closedTabs?.length)} onTabMenuAction={handleTabMenuAction} />
      <NavigationBar key={`${activeTabId}:${firstPane}`} url={firstPage.url} isLoading={firstPage.isLoading}
        autoFocus={addressFocusTabId === activeTabId}
        fillRequest={!isSplitActive && addressFill?.view.tabId === tabPageView(activeTab, firstPane).tabId && addressFill.view.pane === tabPageView(activeTab, firstPane).pane ? addressFill : undefined}
        onFillApplied={handleFillApplied}
        downloadsAnchor={downloadsAnchor}
        canGoBack={firstPage.canGoBack} canGoForward={firstPage.canGoForward}
        isSplitActive={isSplitActive} showAiDock={showAiDock} showBookmarks={showBookmarks}
        onNavigate={(url) => handlePaneNavigate(firstPane, url)}
        onGoBack={() => { void handlePaneAction(firstPane, 'back'); }}
        onGoForward={() => { void handlePaneAction(firstPane, 'forward'); }}
        onReload={() => { void handlePaneAction(firstPane, 'reload'); }}
        onGoHome={() => handlePaneNavigate(firstPane, 'https://www.google.com')}
        onToggleSplit={handleToggleSplit} onToggleAiDock={() => toggleToolbar('showAiDock')}
        onToggleBookmarks={() => toggleToolbar('showBookmarks')}
        showDownloads={showDownloads || hoverDownloads} downloadsPinned={showDownloads}
        downloadCount={downloadIndicator.count} downloadPercent={downloadIndicator.percent} downloadComplete={downloadIndicator.complete}
        onHoverDownloads={setHoverDownloads}
        onToggleDownloads={() => { setShowDownloads((previous) => !previous); setHoverDownloads(false); }} />
      {showDownloads && <Downloads downloads={downloads} onClose={() => { setShowDownloads(false); setHoverDownloads(false); }} />}
      {settingsError && <div role="alert" className="flex items-center justify-between gap-4 bg-red-950/70 px-4 py-2 text-xs text-red-200"><span>{settingsError}</span><button onClick={() => setSettingsError('')} className="underline shrink-0">Dismiss</button></div>}
      <DownloadsPreview visible={hoverDownloads && !showDownloads} anchor={downloadsAnchor} downloads={downloads} />
      <BookmarksBar visible={showBookmarks} getCurrentPage={() => bookmarkPage().page}
        onOpen={(url, newTab) => { if (newTab) handleNewTab(url); else handlePaneNavigate(bookmarkPage().pane, url); }}
        onDialogChange={setEditorOpen} />
      {showAiDock && <LocalhostDock onOpenServer={handleOpenServer} onDialogChange={setEditorOpen} />}
      <WebviewContainer activeTab={activeTab} splitTab={activeTab.split || INITIAL_TAB}
        focusAddress={addressFocusTabId === activeTabId} onLayoutReady={handleLayoutReady}
        addressFill={addressFill} onFillApplied={handleFillApplied}
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
