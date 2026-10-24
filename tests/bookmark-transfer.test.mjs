import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importBookmarkHtml, exportBookmarkHtml } from '../src/lib/bookmarkTransfer.ts';
import { bookmarkBarItems, bookmarkFolderItems, bookmarkFolderPath, deleteBookmarkFolder, loadBookmarks, moveBookmarkItem, putBookmark } from '../src/lib/bookmarks.ts';

const fixture = readFileSync(new URL('fixtures/bookmarks-chrome.html', import.meta.url), 'utf8');
const empty = () => ({ bookmarks: [], folders: [] });
const names = (items) => items.map((item) => item.kind === 'folder' ? item.folder.name : item.bookmark.title);
function structure(data, folderId = null) {
  return bookmarkFolderItems(data, folderId).map((item) => item.kind === 'folder'
    ? { name: item.folder.name, children: structure(data, item.id) }
    : { title: item.bookmark.title, url: item.bookmark.url });
}

test('Chrome and Edge HTML imports append in order and preserve nested folders, Unicode, empty folders and URLs', () => {
  const existing = putBookmark(empty(), { title: 'Existing', url: 'https://existing.example/', folderId: null });
  const before = JSON.stringify(existing);
  const { data, added, skipped } = importBookmarkHtml(fixture, existing);
  assert.equal(added, 6); assert.equal(skipped, 2);
  assert.equal(JSON.stringify(existing), before, 'import must not mutate existing data');
  assert.equal(data.bookmarks[0], existing.bookmarks[0]);
  assert.deepEqual(names(bookmarkBarItems(data)), ['Existing', 'News & Updates 日本語', 'Work & AI', 'Empty folder', 'Final root bookmark', 'Other bookmarks']);
  const work = data.folders.find((folder) => folder.name === 'Work & AI');
  const cafe = data.folders.find((folder) => folder.name === 'Café');
  assert.equal(cafe.parentId, work.id);
  assert.deepEqual(names(bookmarkFolderItems(data, work.id)), ['Local AI', 'Café', 'Last']);
  assert.equal(bookmarkFolderPath(data, cafe.id), 'Work & AI / Café');
  assert.equal(data.bookmarks.find((bookmark) => bookmark.title.startsWith('News')).url, 'https://example.com/?a=1&b=2');
  assert.equal(data.bookmarks.find((bookmark) => bookmark.title === 'Nested <page>').folderId, cafe.id);
  assert.deepEqual(loadBookmarks({ getItem: () => JSON.stringify(data) }), data);
});

test('HTML export round-trips nested mixed ordering and escapes markup and attribute values', () => {
  let { data } = importBookmarkHtml(fixture, empty());
  const work = data.folders.find((folder) => folder.name === 'Work & AI');
  const cafe = data.folders.find((folder) => folder.name === 'Café');
  data = moveBookmarkItem(data, work.id, 0);
  data = moveBookmarkItem(data, cafe.id, 0, work.id);
  data = putBookmark(data, { title: '<script>"&\'や</script>', url: 'https://example.com/?a=1&b=2', folderId: cafe.id });
  const html = exportBookmarkHtml(data);
  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.match(html, /PERSONAL_TOOLBAR_FOLDER="true"/);
  assert.match(html, /charset=UTF-8/);
  assert.match(html, /a=1&amp;b=2/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('ICON='));
  const imported = importBookmarkHtml(html, empty());
  assert.equal(imported.skipped, 0);
  assert.deepEqual(structure(imported.data), structure(data));
  const again = importBookmarkHtml(html, data);
  assert.equal(again.data.bookmarks.length, data.bookmarks.length * 2);
  assert.equal(new Set([...again.data.bookmarks, ...again.data.folders].map((item) => item.id)).size, again.data.bookmarks.length + again.data.folders.length);
});

test('closed DT tags, lowercase Edge markup and toolbar aliases preserve the same hierarchy', () => {
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><dl><dt><h3 personal_toolbar_folder="true">Favorites bar</h3><dl>'
    + '<dt><a href="https://example.com/one">One</a></dt>'
    + '<dt><h3>Folder</h3></dt><dl><dt><a href="https://example.com/two">Two</a></dt></dl>'
    + '<dt><a href="https://example.com/three">Three</a></dt></dl></dt></dl>';
  const { data } = importBookmarkHtml(html, empty());
  assert.deepEqual(names(bookmarkBarItems(data)), ['One', 'Folder', 'Three']);
  assert.deepEqual(names(bookmarkFolderItems(data, data.folders[0].id)), ['Two']);
});

test('invalid files, excessive nesting and executable or internal URLs never replace the collection', () => {
  const existing = putBookmark(empty(), { title: 'Keep', url: 'https://keep.example/', folderId: null });
  const before = JSON.stringify(existing);
  for (const html of ['not an HTML bookmark export', '<html><body>Just a page</body></html>', '<DL><p></DL>',
    '<DL><DT><A HREF="javascript:alert(1)">Run</A><DT><A HREF="file:///secret">Local</A></DL>']) {
    assert.throws(() => importBookmarkHtml(html, existing));
  }
  assert.throws(() => importBookmarkHtml('x'.repeat(10 * 1024 * 1024 + 1), existing), /too large/);
  assert.throws(() => importBookmarkHtml('<DL><DT><H3>Nested</H3>'.repeat(70) + '<DL><DT><A HREF="https://example.com/">Deep</A></DL>' + '</DL>'.repeat(70), existing), /nested folders/);
  const { data, skipped } = importBookmarkHtml('<DL><DT><A HREF="https://safe.example/" onclick="evil()"><img src="https://tracker.example/">Safe</A><SCRIPT>evil()</SCRIPT>'
    + '<DT><A HREF="data:text/html,evil">Bad</A></DL>', existing);
  assert.equal(skipped, 1); assert.equal(data.bookmarks.at(-1).title, 'Safe');
  assert.deepEqual(Object.keys(data.bookmarks.at(-1)).sort(), ['folderId', 'id', 'title', 'url']);
  assert.equal(JSON.stringify(existing), before);
});

test('nested folder validation rejects cycles and missing parents without breaking legacy storage', () => {
  assert.deepEqual(loadBookmarks({ getItem: () => JSON.stringify({ folders: [{ id: 'root', name: 'Old folder' }], bookmarks: [] }) }).folders[0], { id: 'root', name: 'Old folder' });
  for (const folders of [
    [{ id: 'a', name: 'A', parentId: 'missing' }],
    [{ id: 'a', name: 'A', parentId: 'a' }],
    [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }],
    [{ id: 'a', name: 'A', order: [4] }],
  ]) assert.throws(() => loadBookmarks({ getItem: () => JSON.stringify({ folders, bookmarks: [] }) }), /Invalid bookmark folder/);
});

test('deleting a folder removes only that subtree and cleans its parent order without orphaning bookmarks', () => {
  const { data } = importBookmarkHtml(fixture, empty());
  const before = JSON.stringify(data);
  const work = data.folders.find((folder) => folder.name === 'Work & AI');
  const cafe = data.folders.find((folder) => folder.name === 'Café');
  const childDeleted = deleteBookmarkFolder(data, cafe.id);
  assert.deepEqual(names(bookmarkFolderItems(childDeleted, work.id)), ['Local AI', 'Last']);
  assert.equal(childDeleted.folders.find((folder) => folder.id === work.id).order.includes(cafe.id), false);
  assert.equal(childDeleted.bookmarks.some((bookmark) => bookmark.title === 'Nested <page>'), false);
  const deleted = deleteBookmarkFolder(data, work.id);
  assert.deepEqual(names(bookmarkBarItems(deleted)), ['News & Updates 日本語', 'Empty folder', 'Final root bookmark', 'Other bookmarks']);
  assert.equal(deleted.folders.some((folder) => folder.id === cafe.id), false);
  assert.equal(deleted.bookmarks.some((bookmark) => [work.id, cafe.id].includes(bookmark.folderId)), false);
  assert.deepEqual(loadBookmarks({ getItem: () => JSON.stringify(deleted) }), deleted);
  assert.equal(JSON.stringify(data), before);
  assert.equal(deleteBookmarkFolder(data, 'missing'), data);
});
