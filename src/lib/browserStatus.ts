import type { BrowserPane, Tab } from '../types/browser';
import { faviconData } from './favicon.ts';

export interface BrowserStatus {
  tabId?: string;
  pane?: BrowserPane;
  url?: string | null;
  title?: string | null;
  favicon?: string | null;
  faviconPageUrl?: string | null;
  isLoading?: boolean | null;
  canGoBack?: boolean | null;
  canGoForward?: boolean | null;
  isMuted?: boolean | null;
}

export function applyBrowserStatus(tab: Tab, status: BrowserStatus): Tab {
  const url = status.url && !status.url.startsWith('data:text/html') ? status.url : tab.url;
  const title = status.title && !status.title.includes('AuraView') ? status.title
    : url !== tab.url ? (url.includes('google.com') ? 'Google' : url) : tab.title;
  const sameSite = (left: string, right: string) => {
    try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
  };
  const favicon = status.favicon !== undefined && status.faviconPageUrl === url ? faviconData(status.favicon)
    : sameSite(tab.url, url) ? tab.favicon : undefined;
  return {
    ...tab, url, inputUrl: url, title,
    favicon,
    isLoading: status.isLoading ?? tab.isLoading,
    canGoBack: status.canGoBack ?? tab.canGoBack,
    canGoForward: status.canGoForward ?? tab.canGoForward,
    isMuted: status.isMuted ?? tab.isMuted,
    isAiServer: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url),
  };
}
