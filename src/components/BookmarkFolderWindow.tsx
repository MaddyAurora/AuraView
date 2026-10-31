import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { BookmarkData, loadBookmarks, moveBookmarkItem, saveBookmarks } from '../lib/bookmarks';
import { BookmarkFolderContents } from './BookmarkFolderContents';

export function BookmarkFolderWindow() {
  const [folderId, setFolderId] = useState('');
  const [data, setData] = useState<BookmarkData>({ bookmarks: [], folders: [] });
  const [error, setError] = useState('');
  const close = () => { void invoke('close_bookmark_folder').catch(console.error); };
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    try { setData(loadBookmarks(window.localStorage)); } catch { setError('Unable to read bookmarks.'); }
    invoke<string>('get_bookmark_folder').then((id) => { if (!disposed) setFolderId(id); }).catch(() => setError('Unable to open this folder.'));
    listen<BookmarkData>('bookmarks-changed', (event) => setData(event.payload)).then(retain).catch(console.error);
    listen<string>('bookmark-folder-selected', (event) => setFolderId(event.payload)).then(retain).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);
  return <div className="flex h-screen flex-col overflow-hidden rounded-md border border-[var(--av-374151)] bg-[var(--av-111923)]" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
    <div className="min-h-0 flex-1">
      <BookmarkFolderContents data={data} folderId={folderId} onAction={(action) => {
        void emitTo('main', 'bookmark-menu-select', action).then(() => invoke('close_bookmark_folder')).catch(console.error);
      }} onContext={(id, x, y) => {
        void invoke('show_bookmark_menu', { x, y, items: [
          { id: `open:${id}`, label: 'Open' }, { id: `newtab:${id}`, label: 'Open in new tab' },
          { id: `edit:${id}`, label: 'Edit bookmark…' }, { id: `delete:${id}`, label: 'Delete bookmark' },
        ] }).catch(() => setError('Unable to open bookmark actions.'));
      }} onFolderContext={(id, x, y) => {
        void invoke('show_bookmark_menu', { x, y, items: [
          { id: `add:${id}`, label: 'Add current page…' }, { id: `delete-folder:${id}`, label: 'Delete folder' },
        ] }).catch(() => setError('Unable to open folder actions.'));
      }} onMove={(id, index, selectedFolder) => {
        try {
          const next = moveBookmarkItem(data, id, index, selectedFolder || folderId);
          if (next === data) return;
          saveBookmarks(window.localStorage, next);
          setData(next);
          void emit('bookmarks-changed', next).catch(console.error);
        } catch { setError('Unable to save bookmark order. Please try again.'); }
      }} />
    </div>
    {error && <p role="alert" className="px-3 py-2 text-xs text-red-300">{error}</p>}
  </div>;
}
