import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkFolderContents } from './BookmarkFolderContents';
import type { ComponentProps } from 'react';

export function BookmarkFolderMenu({ x, y, onClose, ...props }: ComponentProps<typeof BookmarkFolderContents> & { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const height = Math.min(400, Math.max(props.data.bookmarks.filter((item) => item.folderId === props.folderId).length, 1) * 32 + 50, window.innerHeight - 16);
  return createPortal(<div ref={ref} style={{ left: Math.max(8, Math.min(x, window.innerWidth - 308)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)), height }}
    className="fixed z-40 w-[300px] overflow-hidden rounded-lg border border-[#374151] shadow-2xl">
    <BookmarkFolderContents {...props} />
  </div>, document.body);
}
