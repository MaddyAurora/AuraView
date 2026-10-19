import type { BrowserPane, BrowserViewRef, Tab } from '../types/browser';
import type { BrowserStatus } from './browserStatus';
import { applyBrowserStatus } from './browserStatus.ts';
import { clampSplitRatio } from './splitResize.ts';

export interface BrowserSession { tabs: Tab[]; activeTabId: string }

export function selectTab(session: BrowserSession, id: string): BrowserSession {
  return session.tabs.some((tab) => tab.id === id) ? { ...session, activeTabId: id } : session;
}

export function addTab(session: BrowserSession, tab: Tab): BrowserSession {
  return { tabs: [...session.tabs, tab], activeTabId: tab.id };
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
  return { tabs: session.tabs.flatMap((item) => item.id === id ? pages : [item]),
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
  return { tabs, activeTabId: session.activeTabId === id ? tabs[tabs.length - 1].id : session.activeTabId };
}
