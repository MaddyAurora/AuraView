import type { Tab } from '../types/browser';
import { orderedTabPages } from './tabState.ts';
import { faviconData } from './favicon.ts';

export interface OverflowPage { title: string; url: string; favicon?: string; isLoading: boolean; isMuted: boolean }
export interface OverflowEntry { id: string; title: string; pages: OverflowPage[] }
export interface OverflowSnapshot { tabs: OverflowEntry[]; activeTabId: string; requestId: number; openingId: number }

export function overflowEntries(tabs: Tab[]): OverflowEntry[] {
  return tabs.map((tab) => {
    const pages = (tab.splitEnabled ? orderedTabPages(tab) : orderedTabPages(tab).slice(0, 1))
      .map(({ page }) => ({ title: page.title || page.url || 'New tab', url: page.url,
        favicon: faviconData(page.favicon), isLoading: page.isLoading, isMuted: Boolean(page.isMuted) }));
    return { id: tab.id, title: pages.map((page) => page.title).join(' | '), pages };
  });
}

export function overflowPageLabel(page: OverflowPage): string {
  try {
    const url = new URL(page.url);
    return url.protocol === 'file:' ? 'Local file' : url.hostname || page.url;
  } catch { return page.url || 'New tab'; }
}

export function overflowFocusIndex(key: string, index: number, count: number): number {
  if (!count) return -1;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}
