import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface TabMenuTarget { pageId: string; x: number; y: number; canClose: boolean }
interface Props { target: TabMenuTarget; onClosePage: (pageId: string) => void; onDismiss: () => void }

export function TabContextMenu({ target, onClosePage, onDismiss }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClosePage, onDismiss });
  callbacks.current = { onClosePage, onDismiss };

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) callbacks.current.onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); callbacks.current.onDismiss();
      }
    };
    const dismiss = () => callbacks.current.onDismiss();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [target]);

  return createPortal(<div ref={menu} role="menu" aria-label="Tab actions"
    style={{ left: Math.max(0, Math.min(target.x, window.innerWidth - 160)), top: Math.max(0, Math.min(target.y, window.innerHeight - 44)) }}
    className="fixed z-50 w-40 rounded-lg border border-[#374151] bg-[#111923] p-1 shadow-2xl"
    onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <button type="button" role="menuitem" disabled={!target.canClose}
      className="w-full rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#253244] focus:bg-[#253244] focus:outline-none disabled:opacity-40"
      onClick={() => { onClosePage(target.pageId); onDismiss(); }}>Close page</button>
  </div>, document.body);
}
