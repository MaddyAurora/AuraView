import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { BookmarkData, saveBookmarks } from '../lib/bookmarks';
import { BookmarkDialog, BookmarkDraft } from './BookmarkDialog';

export function BookmarkEditorWindow() {
  const [editor, setEditor] = useState<{ draft: BookmarkDraft; data: BookmarkData }>();
  const [error, setError] = useState('');
  const close = () => { void invoke('close_bookmark_editor').catch(() => setError('Unable to close the bookmark editor. Please try again.')); };
  useEffect(() => {
    let disposed = false;
    invoke<{ draft: BookmarkDraft; data: BookmarkData }>('get_bookmark_editor')
      .then((value) => { if (!disposed) setEditor(value); })
      .catch(() => { if (!disposed) setError('Unable to open the bookmark editor. Close this window and try again.'); });
    return () => { disposed = true; };
  }, []);
  if (!editor) return <p role="status" className="p-5 text-xs text-gray-300">{error || 'Opening bookmark…'}</p>;
  return <>
    <BookmarkDialog standalone draft={editor.draft} data={editor.data} onClose={close} onSave={async (data) => {
      try { saveBookmarks(window.localStorage, data); }
      catch { throw new Error('Unable to save bookmarks. Check the available storage and try again.'); }
      await emitTo('main', 'bookmark-editor-saved', data);
      await invoke('close_bookmark_editor');
    }} />
    {error && <p role="alert" className="px-5 text-xs text-red-300">{error}</p>}
  </>;
}
