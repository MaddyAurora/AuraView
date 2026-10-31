import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clampSplitRatio, splitRatioFromPointer } from '../lib/splitResize';

interface SplitDividerProps {
  containerRef: RefObject<HTMLDivElement>;
  ratio: number;
  containerWidth: number;
  onChange: (ratio: number) => void;
}

export function SplitDivider({ containerRef, ratio, containerWidth, onChange }: SplitDividerProps) {
  const isTauri = '__TAURI_INTERNALS__' in window;
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const drag = useRef<{ pointerId: number; offset: number; handle: HTMLDivElement; native: boolean } | null>(null);
  const pollFrame = useRef(0);
  const resizeFrame = useRef(0);
  const pendingX = useRef<number | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const resizeAt = (clientX: number) => {
    const container = containerRef.current;
    if (!container || !drag.current) return;
    const bounds = container.getBoundingClientRect();
    change.current(splitRatioFromPointer(clientX, bounds.left, bounds.width, drag.current.offset));
  };
  const queueResize = (clientX: number) => {
    pendingX.current = clientX;
    if (resizeFrame.current) return;
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = 0;
      if (pendingX.current !== null) resizeAt(pendingX.current);
      pendingX.current = null;
    });
  };
  const stopDrag = () => {
    const session = drag.current;
    if (!session) return;
    if (pendingX.current !== null) resizeAt(pendingX.current);
    drag.current = null;
    pendingX.current = null;
    cancelAnimationFrame(pollFrame.current);
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = 0;
    if (session.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
    setDragging(false);
    // Native pages can retain the UI webview's CSS hover after capture ends.
    // Require a fresh pointer event before showing the mouse highlight again.
    setHovered(false);
  };

  useEffect(() => () => {
    const session = drag.current;
    drag.current = null;
    cancelAnimationFrame(pollFrame.current);
    cancelAnimationFrame(resizeFrame.current);
    if (session?.handle.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const session = { pointerId: event.pointerId,
      offset: event.clientX - event.currentTarget.getBoundingClientRect().left,
      handle: event.currentTarget, native: isTauri && event.pointerType === 'mouse' };
    drag.current = session;
    event.currentTarget.focus();
    setKeyboardFocused(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (session.native) {
      const poll = async () => {
        try {
          const pointer = await invoke<{ x: number; pressed: boolean }>('get_split_drag_pointer');
          if (drag.current !== session) return;
          queueResize(pointer.x);
          if (!pointer.pressed) { stopDrag(); return; }
          pollFrame.current = requestAnimationFrame(() => { void poll(); });
        } catch (error) {
          console.error('Split drag tracking error:', error);
          if (drag.current === session) stopDrag();
        }
      };
      void poll();
    }
  };

  const minimum = clampSplitRatio(0, containerWidth);
  const maximum = clampSplitRatio(1, containerWidth);
  const highlighted = dragging || hovered || keyboardFocused;
  return <div role="separator" aria-label="Resize split panes" aria-orientation="vertical"
    aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round(maximum * 100)}
    aria-valuenow={Math.round(ratio * 100)} aria-valuetext={`${Math.round(ratio * 100)}% left pane`}
    tabIndex={0} title="Drag to resize. Double-click to reset to equal widths."
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onPointerDown={startDrag} onPointerMove={(event) => {
      if (drag.current) queueResize(event.clientX);
      else setHovered(true);
    }}
    onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) { queueResize(event.clientX); stopDrag(); } }}
    onPointerCancel={() => { if (!drag.current?.native) stopDrag(); }}
    onLostPointerCapture={() => { if (!drag.current?.native) stopDrag(); }}
    onFocus={(event) => setKeyboardFocused(event.currentTarget.matches(':focus-visible'))}
    onBlur={() => setKeyboardFocused(false)}
    onDoubleClick={() => change.current(0.5)}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { stopDrag(); return; }
      const next = event.key === 'ArrowLeft' ? ratio - 0.02 : event.key === 'ArrowRight' ? ratio + 0.02
        : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : undefined;
      if (next !== undefined) {
        event.preventDefault();
        setKeyboardFocused(true);
        change.current(clampSplitRatio(next, containerWidth));
      }
    }}
    className={`flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center select-none outline-none transition-colors ${highlighted ? 'bg-cyan-500/25' : 'bg-[var(--av-090c10)]'}`}>
    <span className={`h-full w-px transition-colors ${highlighted ? 'bg-cyan-400' : 'bg-[var(--av-374151)]'}`} />
  </div>;
}
