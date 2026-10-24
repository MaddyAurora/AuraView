import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkFolderContents } from './BookmarkFolderContents';
import { bookmarkFolderItems } from '../lib/bookmarks';
import type { ComponentProps } from 'react';

export function BookmarkFolderMenu({ x, y, onClose, ...props }: ComponentProps<typeof BookmarkFolderContents> & { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      // Leave the opener's left click to the toolbar toggle. Closing here on
      // pointerdown would make its later click reopen the same folder.
      if (event.button === 0 && event.target instanceof Element && event.target.closest('[data-bookmark-folder]')?.getAttribute('data-bookmark-folder') === props.folderId) return;
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', onClose); };
  }, [onClose, props.folderId]);
  const items = bookmarkFolderItems(props.data, props.folderId);
  const height = Math.min(400, items.some((item) => item.kind === 'folder') ? 400 : Math.max(items.length, 1) * 32 + 50, window.innerHeight - 16);
  return createPortal(<div ref={ref} style={{ left: Math.max(8, Math.min(x, window.innerWidth - 308)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)), height }}
    className="fixed z-40 w-[300px] overflow-hidden rounded-lg border border-[#374151] shadow-2xl">
    <BookmarkFolderContents {...props} />
  </div>, document.body);
}
