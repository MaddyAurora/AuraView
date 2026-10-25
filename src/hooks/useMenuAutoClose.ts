import { useEffect, useRef } from 'react';

export function useMenuAutoClose(onClose: () => void, enabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inside = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
  const restart = () => {
    cancel();
    if (enabled && !inside.current) timer.current = setTimeout(() => {
      timer.current = undefined;
      close.current();
    }, 1000);
  };
  useEffect(() => {
    // This also handles opening directly beneath a stationary pointer.
    inside.current = root.current?.matches(':hover') ?? false;
    restart();
    return cancel;
  }, [enabled]);
  return {
    ref: root,
    onMouseEnter: () => { inside.current = true; cancel(); },
    onMouseLeave: () => { inside.current = false; restart(); },
    onKeyDown: restart,
  };
}
