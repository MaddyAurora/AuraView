import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { AIDockDialog } from './AIDockDialog';
import { loadAiDock, putAiDockServer, saveAiDock } from '../lib/aiDock';
import type { AIDockDraft } from '../lib/aiDock';

export function AIDockEditorWindow() {
  const [draft, setDraft] = useState<AIDockDraft>();
  const [error, setError] = useState('');
  const savedId = useRef<string | undefined>();
  const close = () => { void invoke('close_ai_dock_editor').catch(() => setError('Unable to close the editor. Please try again.')); };
  useEffect(() => {
    let disposed = false;
    invoke<AIDockDraft>('get_ai_dock_editor').then((value) => { if (!disposed) setDraft(value); })
      .catch(() => { if (!disposed) setError('Unable to open the Local Hub editor. Close this window and try again.'); });
    return () => { disposed = true; };
  }, []);
  if (!draft) return <p role="status" className="p-5 text-xs text-gray-300">{error || 'Opening Local Hub entry…'}</p>;
  return <>
    <AIDockDialog standalone draft={draft} onClose={close} onSave={async (value) => {
      const next = putAiDockServer(loadAiDock(window.localStorage), { ...value, id: savedId.current || value.id });
      try { saveAiDock(window.localStorage, next); }
      catch { throw new Error('Unable to save Local Hub entries. Check the available storage and try again.'); }
      savedId.current = value.id || savedId.current || next[next.length - 1].id;
      await emitTo('main', 'ai-dock-changed', next);
      await invoke('close_ai_dock_editor');
    }} />
    {error && <p role="alert" className="px-5 text-xs text-red-300">{error}</p>}
  </>;
}
