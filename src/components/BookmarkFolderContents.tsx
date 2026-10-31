import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark as BookmarkIcon, ChevronRight, Folder, Plus } from 'lucide-react';
import { BookmarkData, bookmarkFolderItems, bookmarkFolderPath } from '../lib/bookmarks';
import { useBookmarkReorder } from '../hooks/useBookmarkReorder';
import { SiteIcon } from './SiteIcon';

interface Props {
  data: BookmarkData;
  folderId: string;
  onAction: (action: string) => void;
  onContext: (id: string, x: number, y: number) => void;
  onFolderContext?: (id: string, x: number, y: number) => void;
  onMove: (id: string, index: number, folderId?: string) => void;
}

export function BookmarkFolderContents({ data, folderId, onAction, onContext, onFolderContext, onMove }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(folderId);
  useEffect(() => setSelected(folderId), [folderId]);
  const current = data.folders.some((folder) => folder.id === selected) ? selected : folderId;
  useEffect(() => { list.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [current]);
  const children = bookmarkFolderItems(data, current);
  const reorder = useBookmarkReorder(list, children.map((item) => item.id), 'y', (id, index) => onMove(id, index, current));
  return <div role="menu" aria-label={bookmarkFolderPath(data, current) || 'Bookmark folder'} className="flex h-full min-h-0 flex-col bg-[var(--av-111923)] p-1 text-xs text-gray-200"
    onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[index]?.focus();
    }}>
    <div ref={list} className="flex min-h-0 flex-1 flex-col overflow-y-auto touch-none" {...reorder.events}>
      {current !== folderId && <button type="button" role="menuitem" className="mb-1 flex shrink-0 items-center gap-2 rounded border-b border-[var(--av-263545)] px-3 py-2 text-left text-amber-300 hover:bg-[var(--av-253244)]" title={bookmarkFolderPath(data, current)}
        onClick={() => setSelected(data.folders.find((folder) => folder.id === current)?.parentId || folderId)}><ArrowLeft className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{data.folders.find((folder) => folder.id === current)?.name}</span></button>}
      {reorder.order.map((id) => {
        const item = children.find((item) => item.id === id)!;
        const style = `flex w-full shrink-0 items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--av-253244)] focus-visible:bg-[var(--av-253244)] focus-visible:outline-none ${reorder.draggedId === id ? 'cursor-grabbing bg-amber-400/10 opacity-60 ring-1 ring-inset ring-amber-400/50' : 'cursor-grab'}`;
        if (item.kind === 'folder') return <button type="button" key={id} role="menuitem" data-bookmark-item={id} aria-haspopup="menu"
          className={style} title={item.folder.name} onPointerDown={(event) => reorder.onPointerDown(event, id)} onClick={() => { setSelected(id); if (list.current) list.current.scrollTop = 0; }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onFolderContext?.(id, event.clientX, event.clientY); }}>
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" /><span className="min-w-0 flex-1 truncate">{item.folder.name}</span><ChevronRight className="h-3 w-3 shrink-0" />
        </button>;
        const bookmark = item.bookmark;
        return <button type="button" key={id} role="menuitem" data-bookmark-item={id} autoFocus={id === reorder.order[0]}
          className={style}
          title={`${bookmark.title}\n${bookmark.url}`} onPointerDown={(event) => reorder.onPointerDown(event, id)}
          onClick={(event) => onAction(`${event.ctrlKey || event.metaKey ? 'newtab' : 'open'}:${id}`)}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onAction(`newtab:${id}`); } }}
          onContextMenu={(event) => { event.preventDefault(); onContext(id, event.clientX, event.clientY); }}>
          <SiteIcon favicon={bookmark.favicon} fallback={<BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-gray-500" />} /><span className="truncate">{bookmark.title}</span>
        </button>;
      })}
      {!children.length && <p className="px-3 py-3 text-gray-500">This folder is empty</p>}
    </div>
    <button role="menuitem" type="button" className="mt-1 flex shrink-0 items-center gap-2 rounded border-t border-[var(--av-263545)] px-3 py-2 text-left text-amber-300 hover:bg-[var(--av-253244)] focus-visible:bg-[var(--av-253244)] focus-visible:outline-none"
      onClick={() => onAction(`add:${current}`)}><Plus className="h-3.5 w-3.5" />Add current page…</button>
  </div>;
}
