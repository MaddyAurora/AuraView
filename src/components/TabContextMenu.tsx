import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { tabMenuItems, TabMenuAction, TabMenuTarget } from '../lib/tabContextMenu';

interface Props { target: TabMenuTarget; onAction: (action: TabMenuAction, pageId: string) => void; onDismiss: () => void }

export function TabContextMenu({ target, onAction, onDismiss }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDismiss });
  callbacks.current = { onDismiss };

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) callbacks.current.onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return;
      }
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
    style={{ left: Math.max(0, Math.min(target.x, window.innerWidth - 224)), top: Math.max(0, Math.min(target.y, window.innerHeight - 286)), maxWidth: '100vw', maxHeight: '100vh' }}
    className="fixed z-50 w-56 overflow-y-auto rounded-lg border border-[#374151] bg-[#111923] p-1 shadow-2xl"
    onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    {tabMenuItems(target).map((item) => <div key={item.action}>
      {item.separator && <div role="separator" className="my-1 border-t border-[#374151]" />}
      <button type="button" role="menuitem" disabled={!item.enabled}
      className="w-full rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-[#253244] focus:bg-[#253244] focus:outline-none disabled:opacity-40"
      onClick={() => { onAction(item.action, target.pageId); onDismiss(); }}>{item.label}</button>
    </div>)}
  </div>, document.body);
}
