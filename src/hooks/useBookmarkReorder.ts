import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import { reorderBookmarkIds } from '../lib/bookmarks';

export function useBookmarkReorder(ref: RefObject<HTMLDivElement>, ids: string[], axis: 'x' | 'y', onMove: (id: string, index: number) => void) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const latest = useRef({ ids, axis, onMove });
  latest.current = { ids, axis, onMove };
  const drag = useRef<{ id: string; pointer: number; startX: number; startY: number; x: number; y: number; started: boolean; order: string[]; signature: string } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef(0);

  const update = () => {
    const session = drag.current;
    const element = ref.current;
    if (!session?.started || !element) return;
    const coordinate = latest.current.axis === 'x' ? session.x : session.y;
    const items = Array.from(element.querySelectorAll<HTMLElement>('[data-bookmark-item]'))
      .filter((item) => item.dataset.bookmarkItem !== session.id);
    const index = items.filter((item) => {
      const bounds = item.getBoundingClientRect();
      return coordinate > (latest.current.axis === 'x' ? bounds.left + bounds.width / 2 : bounds.top + bounds.height / 2);
    }).length;
    const next = reorderBookmarkIds(session.order, session.id, index);
    if (next !== session.order) { session.order = next; setPreview(next); }
  };
  const finish = (commit: boolean) => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    setPreview(null);
    setDraggedId(null);
    const element = ref.current;
    if (element?.hasPointerCapture(session.pointer)) element.releasePointerCapture(session.pointer);
    if (commit && session.started && session.signature === JSON.stringify(latest.current.ids)) {
      latest.current.onMove(session.id, session.order.indexOf(session.id));
    }
  };
  const tick = () => {
    const session = drag.current;
    const element = ref.current;
    if (!session?.started || !element) return;
    const bounds = element.getBoundingClientRect();
    const horizontal = latest.current.axis === 'x';
    const coordinate = horizontal ? session.x : session.y;
    const start = horizontal ? bounds.left : bounds.top;
    const end = horizontal ? bounds.right : bounds.bottom;
    const delta = coordinate < start + 24 ? -5 : coordinate > end - 24 ? 5 : 0;
    if (horizontal) element.scrollLeft += delta;
    else element.scrollTop += delta;
    update();
    frame.current = requestAnimationFrame(tick);
  };
  const signature = JSON.stringify(ids);
  useEffect(() => { if (drag.current && drag.current.signature !== signature) finish(false); }, [signature]);
  useEffect(() => {
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); finish(false); } };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(frame.current);
      drag.current = null;
    };
  }, []);

  return { order: preview && drag.current?.signature === signature ? preview : ids, draggedId,
    onPointerDown: (event: PointerEvent, id: string) => {
      suppressClick.current = false;
      if (event.button !== 0 || !event.isPrimary || !ref.current) return;
      drag.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        started: false, order: latest.current.ids, signature: JSON.stringify(latest.current.ids) };
      // Wait for the movement threshold before capturing so ordinary clicks
      // keep their button target, native menus and keyboard focus.
    },
    events: {
      onPointerMove: (event: PointerEvent) => {
        const session = drag.current;
        if (!session || event.pointerId !== session.pointer) return;
        session.x = event.clientX; session.y = event.clientY;
        if (!session.started) {
          if (Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return;
          session.started = true;
          suppressClick.current = true;
          ref.current?.setPointerCapture(session.pointer);
          setDraggedId(session.id);
          frame.current = requestAnimationFrame(tick);
        }
        event.preventDefault();
        update();
      },
      onPointerUp: (event: PointerEvent) => {
        const session = drag.current;
        if (!session || event.pointerId !== session.pointer) return;
        const bounds = ref.current?.getBoundingClientRect();
        finish(Boolean(bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom));
      },
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
      onClickCapture: (event: React.MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
    },
  };
}
