export interface Bookmark { id: string; title: string; url: string; folderId: string | null }
export interface BookmarkFolder { id: string; name: string }
export interface BookmarkData { bookmarks: Bookmark[]; folders: BookmarkFolder[]; barOrder?: string[] }
export type BookmarkBarItem = { id: string; kind: 'folder'; folder: BookmarkFolder } | { id: string; kind: 'bookmark'; bookmark: Bookmark };
export const BOOKMARKS_KEY = 'auraview.bookmarks.v1';

export function bookmarkUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Enter a link for this bookmark.');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value);
  const address = /^https?:\/\//i.test(value) ? value : `${local ? 'http' : 'https'}://${value}`;
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('Enter a valid http:// or https:// link.'); }
  if (!url.hostname || /\s/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) && !local && !/^[^/:]+:\d+(\/|$)/.test(value))) {
    throw new Error('Enter a valid http:// or https:// link.');
  }
  return url.href;
}

export function loadBookmarks(storage: Pick<Storage, 'getItem'>): BookmarkData {
  const raw = storage.getItem(BOOKMARKS_KEY);
  if (!raw) return { bookmarks: [], folders: [] };
  const data = JSON.parse(raw) as BookmarkData;
  if (!data || !Array.isArray(data.bookmarks) || !Array.isArray(data.folders)) throw new Error('Invalid bookmarks data');
  if (data.barOrder !== undefined && (!Array.isArray(data.barOrder) || data.barOrder.some((id) => typeof id !== 'string'))) throw new Error('Invalid bookmarks order');
  const ids = new Set<string>();
  const validId = (id: unknown) => typeof id === 'string' && Boolean(id) && !ids.has(id) && Boolean(ids.add(id));
  for (const folder of data.folders) {
    if (!folder || !validId(folder.id) || typeof folder.name !== 'string' || !folder.name.trim()) throw new Error('Invalid bookmark folder');
  }
  const folders = new Set(data.folders.map((folder) => folder.id));
  for (const bookmark of data.bookmarks) {
    if (!bookmark || !validId(bookmark.id) || typeof bookmark.title !== 'string' || !bookmark.title.trim()
      || typeof bookmark.url !== 'string' || !/^https?:\/\//i.test(bookmark.url)
      || (bookmark.folderId !== null && !folders.has(bookmark.folderId))) throw new Error('Invalid bookmark');
    bookmarkUrl(bookmark.url);
  }
  return data;
}

export function saveBookmarks(storage: Pick<Storage, 'setItem'>, data: BookmarkData): void {
  storage.setItem(BOOKMARKS_KEY, JSON.stringify(data));
}

export function bookmarkBarItems(data: BookmarkData): BookmarkBarItem[] {
  const items: BookmarkBarItem[] = [
    ...data.folders.map((folder): BookmarkBarItem => ({ id: folder.id, kind: 'folder', folder })),
    ...data.bookmarks.filter((bookmark) => bookmark.folderId === null).map((bookmark): BookmarkBarItem => ({ id: bookmark.id, kind: 'bookmark', bookmark })),
  ];
  const remaining = new Map(items.map((item) => [item.id, item]));
  const ordered: BookmarkBarItem[] = [];
  for (const id of data.barOrder || []) {
    const item = remaining.get(id);
    if (item) { ordered.push(item); remaining.delete(id); }
  }
  return [...ordered, ...remaining.values()];
}

export function reorderBookmarkIds(ids: string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || !Number.isFinite(index)) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, Math.trunc(index)));
  if (from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function moveBookmarkItem(data: BookmarkData, id: string, index: number, folderId: string | null = null): BookmarkData {
  if (folderId === null) {
    const ids = bookmarkBarItems(data).map((item) => item.id);
    const barOrder = reorderBookmarkIds(ids, id, index);
    return barOrder === ids ? data : { ...data, barOrder };
  }
  const children = data.bookmarks.filter((item) => item.folderId === folderId);
  const ids = children.map((item) => item.id);
  const order = reorderBookmarkIds(ids, id, index);
  if (order === ids) return data;
  const byId = new Map(children.map((item) => [item.id, item]));
  let cursor = 0;
  return { ...data, bookmarks: data.bookmarks.map((item) => item.folderId === folderId ? byId.get(order[cursor++])! : item) };
}

export function putBookmark(data: BookmarkData, draft: { id?: string; title: string; url: string; folderId: string | null; newFolder?: string }): BookmarkData {
  const title = draft.title.trim();
  if (!title) throw new Error('Enter a title for this bookmark.');
  const url = bookmarkUrl(draft.url);
  let folders = data.folders;
  let folderId = draft.folderId;
  if (draft.newFolder !== undefined) {
    const name = draft.newFolder.trim();
    if (!name) throw new Error('Enter a name for the new folder.');
    const existing = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    const folder = existing || { id: crypto.randomUUID(), name };
    if (!existing) folders = [...folders, folder];
    folderId = folder.id;
  }
  if (folderId !== null && !folders.some((folder) => folder.id === folderId)) throw new Error('Choose an existing folder or Root.');
  const bookmark = { id: draft.id || crypto.randomUUID(), title, url, folderId };
  const next = { ...data, folders, bookmarks: draft.id
    ? data.bookmarks.map((item) => item.id === draft.id ? bookmark : item)
    : [...data.bookmarks, bookmark] };
  return data.barOrder ? { ...next, barOrder: bookmarkBarItems(next).map((item) => item.id) } : next;
}
