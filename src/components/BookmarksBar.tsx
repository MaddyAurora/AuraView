import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark as BookmarkIcon, ChevronDown, Folder, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { BookmarkData, bookmarkBarItems, loadBookmarks, moveBookmarkItem, saveBookmarks } from '../lib/bookmarks';
import { BookmarkDialog, BookmarkDraft } from './BookmarkDialog';
import { BookmarkMenu, BookmarkMenuState } from './BookmarkMenu';
import { BookmarkFolderMenu } from './BookmarkFolderMenu';
import { useBookmarkReorder } from '../hooks/useBookmarkReorder';

interface Props {
  visible: boolean;
  getCurrentPage: () => { title: string; url: string };
  onOpen: (url: string, newTab?: boolean) => void;
  onDialogChange: (open: boolean) => void;
}

export function BookmarksBar({ visible, getCurrentPage, onOpen, onDialogChange }: Props) {
  const [initial] = useState(() => {
    try { return { data: loadBookmarks(window.localStorage), error: '' }; }
    catch { return { data: { bookmarks: [], folders: [] } as BookmarkData, error: 'Unable to read saved bookmarks. Your saved data has been left intact.' }; }
  });
  const [data, setData] = useState(initial.data);
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  const [menu, setMenu] = useState<BookmarkMenuState | null>(null);
  const [error, setError] = useState(initial.error);
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const isTauri = '__TAURI_INTERNALS__' in window;
  const menuBusy = useRef(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const closeDialog = () => { setDraft(null); onDialogChange(false); };
  const openDialog = (value: BookmarkDraft) => {
    if (initial.error) return;
    setMenu(null);
    setFolderMenu(null);
    onDialogChange(true);
    if (isTauri) {
      void invoke('show_bookmark_editor', { draft: value, data }).catch(() => {
        setError('Unable to open the bookmark editor. Please try again.');
        onDialogChange(false);
      });
    } else setDraft(value);
  };
  const addCurrent = (folderId: string | null = null) => {
    const { title, url } = getCurrentPage();
    openDialog({ title, url, folderId });
  };
  const commit = (next: BookmarkData) => {
    if (initial.error) throw new Error(initial.error);
    try { saveBookmarks(window.localStorage, next); }
    catch { throw new Error('Unable to save bookmarks. Check the available storage and try again.'); }
    setData(next);
    setError('');
    if (isTauri) void emit('bookmarks-changed', next).catch(console.error);
  };
  const act = (action: string) => {
    setMenu(null);
    if (kindClosesFolder(action)) setFolderMenu(null);
    const [kind, id] = action.split(':');
    const bookmark = data.bookmarks.find((item) => item.id === id);
    if (kind === 'add') addCurrent(id || null);
    if (kind === 'open' && bookmark) onOpen(bookmark.url);
    if (kind === 'newtab' && bookmark) onOpen(bookmark.url, true);
    if (kind === 'edit' && bookmark) openDialog(bookmark);
    if (kind === 'delete' && bookmark) {
      try { commit({ ...data, bookmarks: data.bookmarks.filter((item) => item.id !== id) }); }
      catch (reason) { setError((reason as Error).message); }
    }
  };
  const move = (id: string, index: number, folderId: string | null = null) => {
    try {
      const next = moveBookmarkItem(data, id, index, folderId);
      if (next !== data) commit(next);
    } catch (reason) { setError((reason as Error).message); }
  };
  const items = bookmarkBarItems(data);
  const reorder = useBookmarkReorder(strip, items.map((item) => item.id), 'x', (id, index) => move(id, index));
  const actionRef = useRef(act);
  actionRef.current = act;
  const dialogChangeRef = useRef(onDialogChange);
  dialogChangeRef.current = onDialogChange;
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    listen<string>('bookmark-menu-select', (event) => actionRef.current(event.payload))
      .then(retain).catch(console.error);
    listen<BookmarkData>('bookmark-editor-saved', (event) => { setData(event.payload); setError(''); }).then(retain).catch(console.error);
    listen<BookmarkData>('bookmarks-changed', (event) => { setData(event.payload); setError(''); }).then(retain).catch(console.error);
    listen('bookmark-editor-closed', () => dialogChangeRef.current(false)).then(retain).catch(console.error);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [isTauri]);
  useEffect(() => {
    if (!visible) {
      setMenu(null); setFolderMenu(null);
      if (isTauri) void invoke('close_bookmark_folder').catch(console.error);
    }
  }, [visible, isTauri]);

  const showMenu = async (next: BookmarkMenuState) => {
    if (!isTauri) { setMenu(next); return; }
    if (menuBusy.current) return;
    menuBusy.current = true;
    try { await invoke('show_bookmark_menu', { ...next }); }
    catch { setError('Unable to open the bookmarks menu. Please try again.'); }
    finally { menuBusy.current = false; }
  };

  const bookmarkContext = (id: string) => [
    { id: `open:${id}`, label: 'Open' },
    { id: `newtab:${id}`, label: 'Open in new tab' },
    { id: `edit:${id}`, label: 'Edit bookmark…' },
    { id: `delete:${id}`, label: 'Delete bookmark' },
    { id: 'add', label: 'Add current page…' },
  ];
  const chip = 'flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs text-gray-300 transition-colors hover:border-[#334155] hover:bg-[#1a2533] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400';
  return <>
    {visible && <div aria-label="Bookmarks bar" role="toolbar"
      className="flex shrink-0 items-center gap-2 border-b border-[#1a2533] bg-[#0c1017] px-3 py-1.5 select-none"
      onContextMenu={(event) => { event.preventDefault(); void showMenu({ x: event.clientX, y: event.clientY, items: [{ id: 'add', label: 'Add current page…', enabled: !initial.error }] }); }}>
      <div ref={strip} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto touch-none" {...reorder.events}>
        {reorder.order.map((id) => {
          const item = items.find((entry) => entry.id === id)!;
          const style = `${chip} ${reorder.draggedId === id ? 'cursor-grabbing bg-amber-400/10 opacity-60 ring-1 ring-inset ring-amber-400/50' : 'cursor-grab'}`;
          return item.kind === 'folder' ? <button type="button" key={id} data-bookmark-item={id} className={style} aria-haspopup="menu" title={item.folder.name}
            onPointerDown={(event) => reorder.onPointerDown(event, id)} onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const next = { folderId: id, x: bounds.left, y: bounds.bottom + 3 };
              if (isTauri) {
                const count = data.bookmarks.filter((bookmark) => bookmark.folderId === id).length;
                void invoke('show_bookmark_folder', { ...next, height: Math.max(count, 1) * 32 + 50 }).catch(() => setError('Unable to open this folder. Please try again.'));
              } else setFolderMenu(folderMenu?.folderId === id ? null : next);
            }}>
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" /><span className="max-w-40 truncate">{item.folder.name}</span><ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
          </button> : <button type="button" key={id} data-bookmark-item={id} className={style} title={`${item.bookmark.title}\n${item.bookmark.url}`}
            onPointerDown={(event) => reorder.onPointerDown(event, id)}
            onClick={(event) => onOpen(item.bookmark.url, event.ctrlKey || event.metaKey)}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onOpen(item.bookmark.url, true); } }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); void showMenu({ x: event.clientX, y: event.clientY, items: bookmarkContext(id) }); }}>
            <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-gray-500" /><span className="max-w-44 truncate">{item.bookmark.title}</span>
          </button>;
        })}
        {!data.bookmarks.length && !data.folders.length && !error && <span className="truncate px-1 text-xs text-gray-500">Right-click here to bookmark the current page</span>}
        {error && <span role="alert" title={error} className="px-1 text-xs text-red-300">{error}</span>}
      </div>
      <button type="button" className={chip} disabled={Boolean(initial.error)} aria-label="Add current page to bookmarks" title="Add current page to bookmarks" onClick={() => addCurrent()}><Plus className="h-3.5 w-3.5" /></button>
    </div>}
    {menu && visible && <BookmarkMenu menu={menu} onSelect={act} onClose={closeMenu} />}
    {draft && <BookmarkDialog draft={draft} data={data} onClose={closeDialog} onSave={(next) => { commit(next); closeDialog(); }} />}
    {folderMenu && visible && <BookmarkFolderMenu {...folderMenu} data={data} onClose={closeFolderMenu} onAction={act}
      onMove={(id, index) => move(id, index, folderMenu.folderId)}
      onContext={(id, x, y) => { void showMenu({ x, y, items: bookmarkContext(id).filter((item) => item.id !== 'add') }); }} />}
  </>;
}

function kindClosesFolder(action: string) { return /^(open|newtab|add|edit):/.test(action) || action === 'add'; }
