export type TabMenuAction = 'refresh' | 'duplicate' | 'mute' | 'close' | 'close-right' | 'close-left' | 'reopen';

export interface TabMenuTarget {
  pageId: string;
  x: number;
  y: number;
  canClose: boolean;
  canCloseLeft: boolean;
  canCloseRight: boolean;
  canReopen: boolean;
  isMuted: boolean;
}

export function tabMenuItems(target: TabMenuTarget): { action: TabMenuAction; label: string; enabled: boolean; separator?: boolean }[] {
  return [
    { action: 'refresh', label: 'Refresh', enabled: true },
    { action: 'duplicate', label: 'Duplicate tab', enabled: true },
    { action: 'mute', label: target.isMuted ? 'Unmute tab' : 'Mute tab', enabled: true },
    { action: 'close', label: 'Close page', enabled: target.canClose, separator: true },
    { action: 'close-right', label: 'Close tabs to the right', enabled: target.canCloseRight },
    { action: 'close-left', label: 'Close tabs to the left', enabled: target.canCloseLeft },
    { action: 'reopen', label: 'Reopen closed tab', enabled: target.canReopen, separator: true },
  ];
}
