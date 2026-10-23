import { useRef } from 'react';
import { Bookmark as BookmarkIcon, Plus } from 'lucide-react';
import { BookmarkData } from '../lib/bookmarks';
import { useBookmarkReorder } from '../hooks/useBookmarkReorder';

interface Props {
  data: BookmarkData;
  folderId: string;
  onAction: (action: string) => void;
  onContext: (id: string, x: number, y: number) => void;
  onMove: (id: string, index: number) => void;
}

export function BookmarkFolderContents({ data, folderId, onAction, onContext, onMove }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const children = data.bookmarks.filter((bookmark) => bookmark.folderId === folderId);
  const reorder = useBookmarkReorder(list, children.map((item) => item.id), 'y', onMove);
  return <div role="menu" aria-label={data.folders.find((folder) => folder.id === folderId)?.name || 'Bookmark folder'} className="flex h-full min-h-0 flex-col bg-[#111923] p-1 text-xs text-gray-200"
    onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[index]?.focus();
    }}>
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto touch-none" {...reorder.events}>
      {reorder.order.map((id) => {
        const bookmark = children.find((item) => item.id === id)!;
        return <button type="button" key={id} role="menuitem" data-bookmark-item={id} autoFocus={id === reorder.order[0]}
          className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[#253244] focus-visible:bg-[#253244] focus-visible:outline-none ${reorder.draggedId === id ? 'cursor-grabbing bg-amber-400/10 opacity-60 ring-1 ring-inset ring-amber-400/50' : 'cursor-grab'}`}
          title={`${bookmark.title}\n${bookmark.url}`} onPointerDown={(event) => reorder.onPointerDown(event, id)}
          onClick={(event) => onAction(`${event.ctrlKey || event.metaKey ? 'newtab' : 'open'}:${id}`)}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onAction(`newtab:${id}`); } }}
          onContextMenu={(event) => { event.preventDefault(); onContext(id, event.clientX, event.clientY); }}>
          <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-gray-500" /><span className="truncate">{bookmark.title}</span>
        </button>;
      })}
      {!children.length && <p className="px-3 py-3 text-gray-500">This folder is empty</p>}
    </div>
    <button role="menuitem" type="button" className="mt-1 flex shrink-0 items-center gap-2 rounded border-t border-[#263545] px-3 py-2 text-left text-amber-300 hover:bg-[#253244] focus-visible:bg-[#253244] focus-visible:outline-none"
      onClick={() => onAction(`add:${folderId}`)}><Plus className="h-3.5 w-3.5" />Add current page…</button>
  </div>;
}
