import { useEffect, useRef, useState } from 'react';
import { Bookmark as BookmarkIcon, X } from 'lucide-react';
import { BookmarkData, bookmarkFolderPath, putBookmark } from '../lib/bookmarks';

export interface BookmarkDraft { id?: string; title: string; url: string; folderId: string | null }
interface Props { draft: BookmarkDraft; data: BookmarkData; onSave: (data: BookmarkData) => void | Promise<void>; onClose: () => void; standalone?: boolean }

export function BookmarkDialog({ draft, data, onSave, onClose, standalone = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(draft.title);
  const [url, setUrl] = useState(draft.url);
  const [folder, setFolder] = useState(draft.folderId || '');
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!standalone) dialog.current?.showModal(); }, [standalone]);

  const form = <form className="p-5" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      try {
        await onSave(putBookmark(data, { ...draft, title, url, folderId: folder === '__new__' ? null : folder || null,
          newFolder: folder === '__new__' ? folderName : undefined }));
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save the bookmark.'); }
      finally { setSaving(false); }
    }}>
      <div className="mb-5 flex items-center gap-2">
        <BookmarkIcon className="h-4 w-4 text-amber-400" />
        <h2 id="bookmark-dialog-title" className="flex-1 text-sm font-semibold">{draft.id ? 'Edit bookmark' : 'Add bookmark'}</h2>
        <button type="button" aria-label="Close bookmark dialog" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 text-xs">
        <label className="block">Title<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} className="bookmark-input" /></label>
        <label className="block">Link<input required type="text" value={url} onChange={(event) => setUrl(event.target.value)} className="bookmark-input" spellCheck={false} /></label>
        <label className="block">Folder<select value={folder} onChange={(event) => setFolder(event.target.value)} className="bookmark-input">
          <option value="">Root</option>
          <option value="__new__">Create folder…</option>
          {data.folders.map((item) => <option key={item.id} value={item.id}>{bookmarkFolderPath(data, item.id)}</option>)}
        </select></label>
        {folder === '__new__' && <label className="block">New folder name<input required value={folderName} onChange={(event) => setFolderName(event.target.value)} className="bookmark-input" placeholder="Folder name" /></label>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2 text-xs">
        <button type="button" onClick={onClose} className="rounded-md border border-[#334155] px-3 py-2 hover:bg-white/5">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-md bg-amber-500 px-4 py-2 font-semibold text-gray-950 hover:bg-amber-400 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>;
  if (standalone) return <div className="min-h-screen bg-[#111923] text-gray-200" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>{form}</div>;
  return <dialog ref={dialog} aria-labelledby="bookmark-dialog-title" onCancel={onClose}
    className="m-auto w-[420px] max-w-[calc(100vw-32px)] rounded-xl border border-[#334155] bg-[#111923] p-0 text-gray-200 shadow-2xl backdrop:bg-transparent"
    onKeyDown={(event) => event.stopPropagation()}>
    {form}
  </dialog>;
}
