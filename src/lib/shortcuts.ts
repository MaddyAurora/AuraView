export type ShortcutAction = 'new-tab' | 'close-tab' | 'reopen-tab' | 'next-tab' | 'previous-tab'
  | 'reload' | 'stop' | 'find' | 'find-next' | 'find-previous' | 'scroll-down' | 'scroll-up'
  | 'print' | 'save' | 'fullscreen' | 'devtools' | 'split' | 'ai-dock' | `tab-${number}`;

export function shortcutAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): ShortcutAction | undefined {
  if (event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === 'f4') return event.shiftKey ? 'reopen-tab' : 'close-tab';
    if (key === 'tab') return event.shiftKey ? 'previous-tab' : 'next-tab';
    if (key === 'g') return event.shiftKey ? 'find-previous' : 'find-next';
    if (event.shiftKey) return;
    if (/^[1-9]$/.test(key)) return `tab-${key}` as ShortcutAction;
    return ({ t: 'new-tab', w: 'close-tab', r: 'reload', f5: 'reload', f: 'find',
      p: 'print', s: 'save', '\\': 'split', d: 'ai-dock' } as Record<string, ShortcutAction>)[key];
  }
  if (key === ' ') return event.shiftKey ? 'scroll-up' : 'scroll-down';
  if (event.shiftKey) return;
  return ({ escape: 'stop', f5: 'reload', f11: 'fullscreen', f12: 'devtools' } as Record<string, ShortcutAction>)[key];
}

export function spaceUsesControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(
    'input, textarea, select, button, a[href], video, audio, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"]'));
}
