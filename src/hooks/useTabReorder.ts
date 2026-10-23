import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, RefObject } from 'react';
import type { Tab } from '../types/browser';
import { orderedTabPages } from '../lib/tabState';
import { tabDragPlacement, tabDragScrollVelocity } from '../lib/tabDrag';
import type { TabDragItem } from '../lib/tabDrag';

interface DragSession {
  id: string;
  pointerId: number;
  startX: number;
  clientX: number;
  scrollLeft: number;
  started: boolean;
  signature: string;
  items: TabDragItem[];
  cards: HTMLDivElement[];
  index: number;
}

function pageCards(strip: HTMLDivElement) {
  return Array.from(strip.querySelectorAll<HTMLDivElement>('[data-tab-page]'))
    .filter((card) => card.dataset.tabOverflow !== 'true');
}

export function useTabReorder(containerRef: RefObject<HTMLDivElement>, tabs: Tab[],
  onSelect: (id: string) => void, onMove: (id: string, index: number) => void) {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const callbacks = useRef({ onSelect, onMove });
  callbacks.current = { onSelect, onMove };
  const signature = JSON.stringify(tabs.map((tab) => [tab.id,
    (tab.splitEnabled ? orderedTabPages(tab) : orderedTabPages(tab).slice(0, 1)).map(({ page }) => page.id)]));
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const drag = useRef<DragSession | null>(null);
  const frame = useRef(0);
  const lastTime = useRef(0);
  const suppressClick = useRef(false);
  const dropPositions = useRef<Map<string, number> | null>(null);
  const settling = useRef<Animation[]>([]);

  const clearVisuals = (session: DragSession) => {
    const strip = containerRef.current;
    if (strip) delete strip.dataset.tabReordering;
    for (const card of session.cards) {
      delete card.dataset.tabDragging;
      card.style.removeProperty('transform');
      card.style.removeProperty('--tab-drag-width');
    }
  };

  const updatePosition = (session: DragSession) => {
    const strip = containerRef.current;
    if (!strip) return;
    const placement = tabDragPlacement(session.items, session.id,
      session.clientX - session.startX + strip.scrollLeft - session.scrollLeft);
    session.index = placement.index;
    for (const card of session.cards) {
      const offset = placement.offsets.get(card.dataset.tabOwner!) || 0;
      const transform = `translateX(${offset}px)`;
      if (card.style.transform !== transform) card.style.transform = transform;
    }
  };

  const finish = (commit: boolean) => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    if (session.started) {
      if (commit) updatePosition(session);
      // Capture the displayed positions before replacing the preview with the
      // real order. The layout effect settles the cards without a second jump.
      dropPositions.current = new Map(session.cards.map((card) => [card.dataset.tabPage!, card.getBoundingClientRect().left]));
      clearVisuals(session);
      if (commit && session.index >= 0) callbacks.current.onMove(session.id, session.index);
      setDraggedTabId(null);
    }
    const strip = containerRef.current;
    if (strip?.hasPointerCapture(session.pointerId)) strip.releasePointerCapture(session.pointerId);
  };

  const tick = (time: number) => {
    const session = drag.current;
    const strip = containerRef.current;
    if (!session?.started || !strip) return;
    const elapsed = lastTime.current ? Math.min(32, time - lastTime.current) : 16;
    lastTime.current = time;
    const bounds = strip.getBoundingClientRect();
    const speed = tabDragScrollVelocity(session.clientX, bounds.left, bounds.right);
    if (speed) strip.scrollLeft += speed * elapsed / 1000;
    updatePosition(session);
    frame.current = requestAnimationFrame(tick);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, id: string) => {
    suppressClick.current = false;
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
    const strip = containerRef.current;
    if (!strip) return;
    event.preventDefault();
    event.stopPropagation();
    callbacks.current.onSelect(id);
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, clientX: event.clientX,
      scrollLeft: strip.scrollLeft, started: false, signature: currentSignature.current, items: [], cards: [], index: -1 };
    strip.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = drag.current;
    const strip = containerRef.current;
    if (!session || !strip || event.pointerId !== session.pointerId) return;
    session.clientX = event.clientX;
    if (!session.started) {
      if (Math.abs(event.clientX - session.startX) < 6) return;
      for (const animation of settling.current) animation.cancel();
      settling.current = [];
      for (const animation of strip.getAnimations()) animation.finish();
      const cards = pageCards(strip);
      // Finish any size transition or entrance fade before capturing drag bounds.
      for (const card of cards) for (const animation of card.getAnimations()) animation.finish();
      const origin = strip.getBoundingClientRect().left;
      const items = new Map<string, TabDragItem>();
      for (const card of cards) {
        const id = card.dataset.tabOwner!;
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--tab-drag-width', `${bounds.width}px`);
        const left = bounds.left - origin + strip.scrollLeft;
        const right = left + bounds.width + (parseFloat(getComputedStyle(card).marginRight) || 0);
        const item = items.get(id);
        if (item) item.width = right - item.left;
        else items.set(id, { id, left, width: right - left });
      }
      session.cards = cards;
      session.items = [...items.values()];
      session.started = true;
      suppressClick.current = true;
      strip.dataset.tabReordering = 'true';
      for (const card of cards) if (card.dataset.tabOwner === session.id) card.dataset.tabDragging = 'true';
      setDraggedTabId(session.id);
      lastTime.current = 0;
      updatePosition(session);
      frame.current = requestAnimationFrame(tick);
    }
  };

  useLayoutEffect(() => {
    // Closing, adding, swapping, or separating a tab cancels a stale drag.
    if (drag.current && drag.current.signature !== signature) finish(false);
    const previous = dropPositions.current;
    const strip = containerRef.current;
    if (!previous || !strip) return;
    dropPositions.current = null;
    settling.current = settling.current.filter((animation) => animation.playState !== 'finished');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const card of pageCards(strip)) {
      const left = previous.get(card.dataset.tabPage!);
      if (left === undefined) continue;
      const delta = left - card.getBoundingClientRect().left;
      if (Math.abs(delta) < 0.5) continue;
      settling.current.push(card.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }));
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
      cancelAnimationFrame(frame.current);
      for (const animation of settling.current) animation.cancel();
      const session = drag.current;
      drag.current = null;
      if (session) {
        clearVisuals(session);
        const strip = containerRef.current;
        if (strip?.hasPointerCapture(session.pointerId)) strip.releasePointerCapture(session.pointerId);
      }
    };
  }, []);

  return { draggedTabId, onPointerDown,
    stripEvents: {
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === event.pointerId) { drag.current.clientX = event.clientX; finish(true); }
      },
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
        if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
        suppressClick.current = false;
      },
      onPointerDownCapture: () => { suppressClick.current = false; },
    },
  };
}
