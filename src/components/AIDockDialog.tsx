import { useEffect, useRef, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { AI_DOCK_COLORS } from '../lib/aiDock';
import type { AIDockDraft } from '../lib/aiDock';

interface Props { draft: AIDockDraft; standalone?: boolean; onSave: (draft: AIDockDraft) => void | Promise<void>; onClose: () => void }

export function AIDockDialog({ draft, standalone = false, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(draft.name), [port, setPort] = useState(draft.port);
  const [description, setDescription] = useState(draft.description), [color, setColor] = useState(draft.color);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { if (!standalone) dialog.current?.showModal(); }, [standalone]);
  const form = <form className="p-5" onSubmit={async (event) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try { await onSave({ ...draft, name, port, description, color }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save this AI Dock entry.'); }
    finally { setSaving(false); }
  }}>
    <div className="mb-5 flex items-center gap-2">
      <Zap className="h-4 w-4 text-purple-400" /><h2 id="ai-dock-dialog-title" className="flex-1 text-sm font-semibold">{draft.id ? 'Edit AI Dock entry' : 'Add AI Dock port'}</h2>
      <button type="button" aria-label="Close AI Dock editor" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
    </div>
    <div className="space-y-4 text-xs">
      <label className="block">Name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="bookmark-input" placeholder="My local AI app" /></label>
      <label className="block">Port<input required type="number" min={1} max={65535} step={1} value={port} onChange={(event) => setPort(event.target.value)} className="bookmark-input" placeholder="8188" /></label>
      <label className="block">Description <span className="text-gray-500">(optional)</span><input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} className="bookmark-input" /></label>
      <fieldset><legend className="mb-2">Dot color</legend>
        <div className="flex flex-wrap gap-2">{AI_DOCK_COLORS.map((preset) => <button type="button" key={preset.value} aria-label={preset.name} aria-pressed={color.toLowerCase() === preset.value}
          title={preset.name} onClick={() => setColor(preset.value)} className={`h-7 w-7 rounded-full border-2 ${color.toLowerCase() === preset.value ? 'border-white ring-2 ring-purple-500' : 'border-transparent hover:border-gray-400'}`}
          style={{ backgroundColor: preset.value }} />)}</div>
        <label className="mt-3 flex items-center gap-3">Custom color<input type="color" aria-label="Custom dot color" value={color} onChange={(event) => setColor(event.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[#334155] bg-[#0c1017] p-1" /><span className="font-mono text-gray-400">{color.toUpperCase()}</span></label>
      </fieldset>
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
    <div className="mt-6 flex justify-end gap-2 text-xs">
      <button type="button" onClick={onClose} className="rounded-md border border-[#334155] px-3 py-2 hover:bg-white/5">Cancel</button>
      <button type="submit" disabled={saving} className="rounded-md bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </form>;
  if (standalone) return <div className="min-h-screen bg-[#111923] text-gray-200" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>{form}</div>;
  return <dialog ref={dialog} aria-labelledby="ai-dock-dialog-title" onCancel={onClose} className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-[#334155] bg-[#111923] p-0 text-gray-200 shadow-2xl backdrop:bg-transparent" onKeyDown={(event) => event.stopPropagation()}>{form}</dialog>;
}
