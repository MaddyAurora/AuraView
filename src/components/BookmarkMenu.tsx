import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface BookmarkMenuItem { id: string; label: string; enabled?: boolean }
export interface BookmarkMenuState { x: number; y: number; items: BookmarkMenuItem[] }

export function BookmarkMenu({ menu, onSelect, onClose, label = 'Bookmarks' }: { menu: BookmarkMenuState; onSelect: (id: string) => void; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      previous?.focus();
    };
  }, [onClose]);
  return createPortal(<div ref={ref} role="menu" aria-label={label} className="fixed z-50 max-h-[60vh] w-64 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-[var(--av-374151)] bg-[var(--av-111923)] p-1 shadow-2xl text-xs"
    style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 264)), top: Math.max(8, Math.min(menu.y, window.innerHeight - Math.min(menu.items.length * 36 + 8, window.innerHeight * 0.6) - 8)) }}
    onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
    {menu.items.map((item) => <button key={item.id} role="menuitem" type="button" disabled={item.enabled === false} title={item.label}
      className="block w-full truncate rounded px-3 py-2 text-left text-gray-200 hover:bg-[var(--av-253244)] focus:bg-[var(--av-253244)] focus:outline-none disabled:opacity-40"
      onClick={() => onSelect(item.id)}>{item.label}</button>)}
  </div>, document.body);
}
