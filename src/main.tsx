import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BookmarkEditorWindow } from './components/BookmarkEditorWindow';
import { BookmarkFolderWindow } from './components/BookmarkFolderWindow';
import { AIDockEditorWindow } from './components/AIDockEditorWindow';
import { DownloadsPreviewWindow } from './components/DownloadsPreview';
import { BrowserHistoryWindow, BrowserSettingsWindow } from './components/BrowserSettings';
import { TabOverflowWindow } from './components/TabOverflowWindow';
import './index.css';
import { initializeTheme } from './lib/theme';

initializeTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {window.location.hash === '#tab-overflow' ? <TabOverflowWindow /> : window.location.hash === '#browser-settings' ? <BrowserSettingsWindow /> : window.location.hash === '#browser-history' ? <BrowserHistoryWindow /> : window.location.hash === '#bookmark-editor' ? <BookmarkEditorWindow /> : window.location.hash === '#bookmark-folder' ? <BookmarkFolderWindow /> : window.location.hash === '#ai-dock-editor' ? <AIDockEditorWindow /> : window.location.hash === '#downloads-preview' ? <DownloadsPreviewWindow /> : <App />}
  </React.StrictMode>
);
