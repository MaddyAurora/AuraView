import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { bookmarkBarItems, bookmarkFolderItems, bookmarkUrl } from './bookmarks.ts';
import type { BookmarkData } from './bookmarks.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
const tag = (node: Node) => 'tagName' in node ? node.tagName : '';
const attribute = (node: Node, name: string) => 'attrs' in node ? node.attrs.find((attr) => attr.name === name)?.value : undefined;
const text = (node: Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : children(node).map(text).join('');

export function importBookmarkHtml(html: string, existing: BookmarkData): { data: BookmarkData; added: number; skipped: number } {
  if (html.length > 10 * 1024 * 1024) throw new Error('This bookmarks file is too large (maximum 10 MB).');
  // Parse into an inert tree. Imported scripts, event handlers, icons and markup
  // never enter a live page; only folder text and validated HTTP(S) links survive.
  const document = parse(html);
  const lists: Element[] = [];
  const findLists = (node: Node) => {
    if (tag(node) === 'dl') { lists.push(node as Element); return; }
    for (const child of children(node)) findLists(child);
  };
  findLists(document);
  if (!lists.length) throw new Error('Choose a bookmarks HTML file exported by Chrome, Edge, or AuraView.');
  const data: BookmarkData = { bookmarks: [...existing.bookmarks], folders: [...existing.folders], barOrder: bookmarkBarItems(existing).map((item) => item.id) };
  let added = 0, skipped = 0;
  const readList = (list: Node, parentId: string | null, depth: number): string[] => {
    if (depth > 64) throw new Error('This bookmarks file has too many nested folders.');
    const order: string[] = [];
    let pending: { id: string; toolbar: boolean } | undefined;
    // Netscape files omit </DT>. HTML parsers can place a folder's <DL>
    // either inside its <DT> or as its following sibling; handle both forms.
    const visit = (node: Node) => {
      if (data.bookmarks.length + data.folders.length > 50_000) throw new Error('This bookmarks file contains too many items.');
      const name = tag(node);
      if (name === 'h3') {
        const toolbar = parentId === null && attribute(node, 'personal_toolbar_folder')?.toLowerCase() === 'true';
        if (toolbar) { pending = { id: '', toolbar: true }; return; }
        const id = crypto.randomUUID();
        data.folders.push({ id, name: text(node).trim() || 'Imported folder', parentId });
        order.push(id); pending = { id, toolbar: false };
        return;
      }
      if (name === 'dl') {
        if (pending) {
          const folder = pending; pending = undefined;
          const nested = readList(node, folder.toolbar ? parentId : folder.id, depth + 1);
          if (folder.toolbar) order.push(...nested);
          else data.folders.find((item) => item.id === folder.id)!.order = nested;
        } else order.push(...readList(node, parentId, depth + 1));
        return;
      }
      if (name === 'a') {
        pending = undefined;
        const href = attribute(node, 'href') || '';
        // Browser-internal pages and executable bookmarklets cannot be opened
        // by AuraView's bookmark model. Report them instead of rewriting them.
        if (!/^https?:\/\//i.test(href.trim())) { skipped++; return; }
        let url: string;
        try { url = bookmarkUrl(href); } catch { skipped++; return; }
        const id = crypto.randomUUID();
        data.bookmarks.push({ id, title: text(node).trim() || url, url, folderId: parentId });
        order.push(id); added++; return;
      }
      if (['script', 'style', 'template', 'iframe'].includes(name)) return;
      for (const child of children(node)) visit(child);
    };
    for (const node of children(list)) visit(node);
    return order;
  };
  for (const list of lists) data.barOrder!.push(...readList(list, null, 0));
  if (!added && data.folders.length === existing.folders.length) throw new Error(skipped
    ? 'No supported bookmarks found. AuraView supports http:// and https:// links.'
    : 'No bookmarks or folders found in this HTML file.');
  return { data, added, skipped };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

export function exportBookmarkHtml(data: BookmarkData): string {
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- Exported by AuraView -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>',
    '    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>', '    <DL><p>'];
  const write = (folderId: string | null, depth: number, ancestors: Set<string>) => {
    if (depth > 66) throw new Error('Too many nested bookmark folders to export.');
    for (const item of bookmarkFolderItems(data, folderId)) {
      const pad = '    '.repeat(depth);
      if (item.kind === 'bookmark') {
        const url = bookmarkUrl(item.bookmark.url);
        lines.push(`${pad}<DT><A HREF="${escape(url)}">${escape(item.bookmark.title)}</A>`);
      } else {
        if (ancestors.has(item.id)) throw new Error('Invalid bookmark folder hierarchy.');
        lines.push(`${pad}<DT><H3>${escape(item.folder.name)}</H3>`, `${pad}<DL><p>`);
        write(item.id, depth + 1, new Set([...ancestors, item.id]));
        lines.push(`${pad}</DL><p>`);
      }
    }
  };
  write(null, 2, new Set());
  lines.push('    </DL><p>', '</DL><p>', '');
  return lines.join('\r\n');
}
