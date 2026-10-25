import { DEFAULT_AI_SERVERS } from '../types/browser.ts';
import type { AIServerBookmark } from '../types/browser.ts';
import { reorderBookmarkIds } from './bookmarks.ts';

export const AI_DOCK_KEY = 'auraview.ai-dock.v1';
export const AI_DOCK_COLORS = [
  { name: 'Amber', value: '#f59e0b' }, { name: 'Cyan', value: '#06b6d4' },
  { name: 'Green', value: '#10b981' }, { name: 'Purple', value: '#a855f7' },
  { name: 'Blue', value: '#3b82f6' }, { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' }, { name: 'Gray', value: '#94a3b8' },
];
export interface AIDockDraft { id?: string; name: string; port: string; color: string; description: string }

export function aiDockPort(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error('Enter a whole-number port from 1 to 65535.');
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a whole-number port from 1 to 65535.');
  return port;
}

export function loadAiDock(storage: Pick<Storage, 'getItem'>): AIServerBookmark[] {
  const raw = storage.getItem(AI_DOCK_KEY);
  if (raw === null) return DEFAULT_AI_SERVERS.map((server) => ({ ...server }));
  const servers: AIServerBookmark[] = JSON.parse(raw);
  if (!Array.isArray(servers)) throw new Error('Invalid Local Hub data.');
  const ids = new Set<string>();
  for (const server of servers) {
    if (!server || typeof server.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(server.id) || ids.has(server.id)
      || typeof server.name !== 'string' || !server.name.trim() || server.name.length > 100
      || typeof server.port !== 'number' || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535
      || typeof server.color !== 'string' || !/^#[\da-f]{6}$/i.test(server.color)
      || typeof server.description !== 'string' || server.description.length > 500
      || typeof server.badge !== 'string'
      || (server.path !== undefined && !/^\/(?!\/)[^\s\\]*$/.test(server.path))) throw new Error('Invalid Local Hub entry.');
    ids.add(server.id);
  }
  return servers;
}

export function saveAiDock(storage: Pick<Storage, 'setItem'>, servers: AIServerBookmark[]): void {
  storage.setItem(AI_DOCK_KEY, JSON.stringify(servers));
}

export function moveAiDockServer(servers: AIServerBookmark[], id: string, index: number): AIServerBookmark[] {
  const ids = servers.map((server) => server.id);
  const order = reorderBookmarkIds(ids, id, index);
  if (order === ids) return servers;
  const byId = new Map(servers.map((server) => [server.id, server]));
  return order.map((id) => byId.get(id)!);
}

export function putAiDockServer(servers: AIServerBookmark[], draft: AIDockDraft): AIServerBookmark[] {
  const name = draft.name.trim(), description = draft.description.trim();
  if (!name || name.length > 100) throw new Error('Enter a name of up to 100 characters.');
  if (description.length > 500) throw new Error('Keep the description under 500 characters.');
  const port = aiDockPort(draft.port);
  if (!/^#[\da-f]{6}$/i.test(draft.color)) throw new Error('Choose a valid dot color.');
  const existing = draft.id ? servers.find((server) => server.id === draft.id) : undefined;
  if (draft.id && !existing) throw new Error('This Local Hub entry no longer exists. Close the editor and try again.');
  const server = { ...existing, id: existing?.id || crypto.randomUUID(), name, port,
    color: draft.color.toLowerCase(), description, badge: existing?.badge || 'Custom port' };
  return existing ? servers.map((item) => item.id === existing.id ? server : item) : [...servers, server];
}

export function aiDockUrl(server: AIServerBookmark): string {
  return `http://localhost:${server.port}${server.path || ''}`;
}

export function aiDockMenu(id?: string, enabled = true) {
  return [
    ...(id ? [{ id: `edit:${id}`, label: 'Edit entry…', enabled }, { id: `delete:${id}`, label: 'Delete entry', enabled }] : []),
    { id: 'add', label: 'Add port…', enabled },
  ];
}
