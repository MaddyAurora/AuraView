import type { BrowserPane, BrowserViewRef, Tab } from '../types/browser';
import type { BrowserStatus } from './browserStatus';
import { applyBrowserStatus } from './browserStatus.ts';
import { clampSplitRatio } from './splitResize.ts';

export interface BrowserSession { tabs: Tab[]; activeTabId: string; closedTabs?: { tab: Tab; index: number }[] }

export function selectTab(session: BrowserSession, id: string): BrowserSession {
  return session.tabs.some((tab) => tab.id === id) ? { ...session, activeTabId: id } : session;
}

export function addTab(session: BrowserSession, tab: Tab): BrowserSession {
  return { ...session, tabs: [...session.tabs, tab], activeTabId: tab.id };
}

export function moveTab(session: BrowserSession, id: string, toIndex: number): BrowserSession {
  const fromIndex = session.tabs.findIndex((tab) => tab.id === id);
  if (fromIndex < 0 || !Number.isFinite(toIndex)) return session;
  const target = Math.max(0, Math.min(session.tabs.length - 1, Math.trunc(toIndex)));
  if (target === fromIndex) return session;
  const tabs = [...session.tabs];
  const [tab] = tabs.splice(fromIndex, 1);
  tabs.splice(target, 0, tab);
  return { ...session, tabs };
}

export function createTab(id: string, url = 'https://www.google.com'): Tab {
  return { id, url, inputUrl: url,
    title: url === 'https://www.google.com' ? 'Google' : new URL(url).hostname,
    isLoading: true, canGoBack: false, canGoForward: false };
}

export function enableTabSplit(tab: Tab, splitId = `tab-${crypto.randomUUID()}`): Tab {
  if (tab.splitEnabled && tab.split) return tab;
  const split = tab.split || createTab(splitId);
  return { ...tab, splitEnabled: true,
    split: tab.split || { ...split, view: { tabId: split.id, pane: 'primary' } } };
}

// A page keeps its native view identity when it moves out of a split group.
export function tabPageView(tab: Tab, pane: BrowserPane): BrowserViewRef {
  if (pane === 'secondary') return tab.split?.view || { tabId: tab.id, pane: 'secondary' };
  return tab.view || { tabId: tab.id, pane: 'primary' };
}

export function tabViews(tab: Tab): BrowserViewRef[] {
  return tab.split ? [tabPageView(tab, 'primary'), tabPageView(tab, 'secondary')] : [tabPageView(tab, 'primary')];
}

export function separateTabSplit(session: BrowserSession, id: string): BrowserSession {
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab?.splitEnabled || !tab.split) return session;
  const pages = orderedTabPages(tab).map(({ pane, page }) => {
    const { split, splitEnabled, splitReversed, splitRatio, ...single } = page;
    return { ...single, view: tabPageView(tab, pane) };
  });
  return { ...session, tabs: session.tabs.flatMap((item) => item.id === id ? pages : [item]),
    activeTabId: session.activeTabId === id ? pages[0].id : session.activeTabId };
}

export function toggleSessionSplit(session: BrowserSession): BrowserSession {
  const tab = session.tabs.find((item) => item.id === session.activeTabId);
  if (!tab) return session;
  if (tab.splitEnabled && tab.split) return separateTabSplit(session, tab.id);
  return { ...session, tabs: session.tabs.map((item) => item.id === tab.id ? enableTabSplit(item) : item) };
}

export function swapTabPages(tab: Tab): Tab {
  return tab.splitEnabled && tab.split ? { ...tab, splitReversed: !tab.splitReversed } : tab;
}

export function resizeTabSplit(tab: Tab, ratio: number): Tab {
  const next = clampSplitRatio(ratio);
  return tab.splitEnabled && tab.split && tab.splitRatio !== next ? { ...tab, splitRatio: next } : tab;
}

export function orderedTabPages(tab: Tab): { pane: BrowserPane; page: Tab }[] {
  const primary = { pane: 'primary' as const, page: tab };
  if (!tab.split) return [primary];
  const secondary = { pane: 'secondary' as const, page: tab.split };
  return tab.splitReversed ? [secondary, primary] : [primary, secondary];
}

export function applyTabStatus(tabs: Tab[], status: BrowserStatus): Tab[] {
  if (!status.tabId) return tabs;
  let changed = false;
  const matches = (view: BrowserViewRef) => view.tabId === status.tabId && view.pane === (status.pane || 'primary');
  const updated = tabs.map((tab) => {
    if (matches(tabPageView(tab, 'primary'))) {
      changed = true;
      return applyBrowserStatus(tab, status);
    }
    if (tab.split && matches(tabPageView(tab, 'secondary'))) {
      changed = true;
      return { ...tab, split: applyBrowserStatus(tab.split, status) };
    }
    return tab;
  });
  return changed ? updated : tabs;
}

export function closeTab(session: BrowserSession, id: string): BrowserSession {
  if (session.tabs.length <= 1 || !session.tabs.some((tab) => tab.id === id)) return session;
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  const index = session.tabs.findIndex((tab) => tab.id === id);
  return { ...session, tabs, activeTabId: session.activeTabId === id ? tabs[tabs.length - 1].id : session.activeTabId,
    closedTabs: [...(session.closedTabs || []), { tab: session.tabs[index], index }].slice(-20) };
}

export function findTabPage(tabs: Tab[], pageId: string) {
  for (const owner of tabs) {
    const entry = orderedTabPages(owner).find(({ page }) => page.id === pageId);
    if (entry) return { owner, ...entry };
  }
}

export function tabsOnSide(tabs: Tab[], id: string, side: 'left' | 'right'): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  return index < 0 ? [] : side === 'left' ? tabs.slice(0, index) : tabs.slice(index + 1);
}

export function closeTabsOnSide(session: BrowserSession, id: string, side: 'left' | 'right'): BrowserSession {
  // Remove rightmost tabs first so LIFO reopening restores each original position.
  const closing = tabsOnSide(session.tabs, id, side);
  return closing.reverse().reduce((next, tab) => closeTab(next, tab.id), session);
}

export function duplicateTabPage(session: BrowserSession, pageId: string): BrowserSession {
  const target = findTabPage(session.tabs, pageId);
  if (!target) return session;
  const { split, splitEnabled, splitReversed, splitRatio, view, ...page } = target.page;
  const duplicate = { ...page, id: `tab-${crypto.randomUUID()}`, inputUrl: page.url,
    isLoading: true, canGoBack: false, canGoForward: false };
  const tabs = [...session.tabs];
  tabs.splice(tabs.indexOf(target.owner) + 1, 0, duplicate);
  return { ...session, tabs, activeTabId: duplicate.id };
}

export function closeTabPage(session: BrowserSession, id: string, pane: BrowserPane): BrowserSession {
  const index = session.tabs.findIndex((tab) => tab.id === id);
  const tab = session.tabs[index];
  if (!tab?.splitEnabled || !tab.split) return pane === 'primary' ? closeTab(session, id) : session;
  const single = (page: Tab, pagePane: BrowserPane): Tab => {
    const { split, splitEnabled, splitReversed, splitRatio, ...rest } = page;
    return { ...rest, view: tabPageView(tab, pagePane) };
  };
  const closed = single(pane === 'primary' ? tab : tab.split, pane);
  const remaining = single(pane === 'primary' ? tab.split : tab, pane === 'primary' ? 'secondary' : 'primary');
  const closedIndex = index + orderedTabPages(tab).findIndex((page) => page.pane === pane);
  return { ...session,
    tabs: session.tabs.map((item) => item.id === id ? remaining : item),
    activeTabId: session.activeTabId === id ? remaining.id : session.activeTabId,
    closedTabs: [...(session.closedTabs || []), { tab: closed, index: closedIndex }].slice(-20),
  };
}

export function reopenTab(session: BrowserSession): BrowserSession {
  const closed = session.closedTabs?.[session.closedTabs.length - 1];
  if (!closed) return session;
  // Closed native views are retired permanently. Restore URLs/layout into fresh views.
  const restore = (page: Tab): Tab => ({ ...page, id: `tab-${crypto.randomUUID()}`, view: undefined,
    isLoading: true, canGoBack: false, canGoForward: false,
    split: page.split ? restore(page.split) : undefined });
  const tab = restore(closed.tab);
  const tabs = [...session.tabs];
  tabs.splice(Math.min(closed.index, tabs.length), 0, tab);
  return { ...session, tabs, activeTabId: tab.id, closedTabs: session.closedTabs!.slice(0, -1) };
}

export function switchTab(session: BrowserSession, direction: number): BrowserSession {
  const index = session.tabs.findIndex((tab) => tab.id === session.activeTabId);
  const next = (index + direction + session.tabs.length) % session.tabs.length;
  return selectTab(session, session.tabs[next].id);
}
