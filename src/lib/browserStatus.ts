import type { BrowserPane, Tab } from '../types/browser';

export interface BrowserStatus {
  tabId?: string;
  pane?: BrowserPane;
  url?: string | null;
  title?: string | null;
  isLoading?: boolean | null;
  canGoBack?: boolean | null;
  canGoForward?: boolean | null;
}

export function applyBrowserStatus(tab: Tab, status: BrowserStatus): Tab {
  const url = status.url && !status.url.startsWith('data:text/html') ? status.url : tab.url;
  const title = status.title && !status.title.includes('AuraView') ? status.title
    : url !== tab.url ? (url.includes('google.com') ? 'Google' : url) : tab.title;
  return {
    ...tab, url, inputUrl: url, title,
    isLoading: status.isLoading ?? tab.isLoading,
    canGoBack: status.canGoBack ?? tab.canGoBack,
    canGoForward: status.canGoForward ?? tab.canGoForward,
    isAiServer: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url),
  };
}
