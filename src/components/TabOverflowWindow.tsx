import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TabOverflowMenu } from './TabOverflowMenu';
import type { OverflowSnapshot } from '../lib/tabOverflow';

export function TabOverflowWindow() {
  const [snapshot, setSnapshot] = useState<OverflowSnapshot>();
  const [error, setError] = useState('');
  const [visibleOpening, setVisibleOpening] = useState<number>();
  const dismissedThrough = useRef(0);
  const close = (restoreFocus = true) => {
    void invoke('close_tab_overflow', { restoreFocus, openingId: snapshot?.openingId }).catch(console.error);
  };
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    // Subscribe before reading so a newer opening cannot be missed during load.
    void Promise.all([
      listen<OverflowSnapshot>('tab-overflow-updated', (event) => {
        if (event.payload.openingId <= dismissedThrough.current) return;
        setSnapshot((current) => !current || event.payload.requestId >= current.requestId ? event.payload : current);
      }).then(retain),
      listen<number>('tab-overflow-dismissed', (event) => {
        dismissedThrough.current = Math.max(dismissedThrough.current, event.payload);
        setVisibleOpening((current) => current === event.payload ? undefined : current);
      }).then(retain),
    ]).then(async () => {
      if (disposed) return;
      const current = await invoke<OverflowSnapshot | null>('get_tab_overflow');
      if (!disposed && current && current.openingId > dismissedThrough.current)
        setSnapshot((previous) => !previous || current.requestId >= previous.requestId ? current : previous);
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);
  useEffect(() => {
    let disposed = false;
    if (snapshot) void invoke('tab_overflow_ready', { requestId: snapshot.requestId }).then(() => {
      if (!disposed && snapshot.openingId > dismissedThrough.current) setVisibleOpening(snapshot.openingId);
    }).catch(console.error);
    return () => { disposed = true; };
  }, [snapshot]);
  return <div className="h-screen overflow-hidden bg-[var(--av-111923)]">
    {snapshot ? <TabOverflowMenu key={snapshot.openingId} entries={snapshot.tabs} activeTabId={snapshot.activeTabId} onClose={() => close()}
      autoCloseEnabled={visibleOpening === snapshot.openingId} onAutoClose={() => close(false)}
      onCloseTab={(tabId) => { void invoke('close_overflow_tab', { tabId, requestId: snapshot.requestId }).catch((reason) => setError(String(reason))); }}
      onSelect={(tabId) => { void invoke('select_overflow_tab', { tabId, requestId: snapshot.requestId }).catch((reason) => setError(String(reason))); }} />
      : <button className="p-3 text-xs text-gray-300" onClick={() => close()}>Close tabs menu</button>}
    {error && <p role="alert" className="absolute bottom-0 bg-[var(--av-111923)] p-2 text-xs text-red-300">{error}</p>}
  </div>;
}
