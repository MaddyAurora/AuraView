import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Clock, Cookie, Eraser, LoaderCircle, LogOut, Palette, Settings, ShieldCheck, X } from 'lucide-react';
import { readTheme, saveTheme, themes, ThemeId } from '../lib/theme';

interface SettingsData { keepHistory: boolean; adblockEnabled: boolean }
type Cleanup = 'history' | 'cookies' | 'sessions';
const actions: { id: Cleanup; label: string; description: string; icon: typeof Clock }[] = [
  { id: 'history', label: 'Clear browser history', description: 'Visited URLs and download records. Keeps logins, cookies and downloaded files.', icon: Eraser },
  { id: 'cookies', label: 'Clear cookies', description: 'Removes website cookies. May sign you out. Reloads open pages.', icon: Cookie },
  { id: 'sessions', label: 'Clear login sessions', description: 'Clears cookies and website storage, then reloads pages. Keeps bookmarks and Local Hub.', icon: LogOut },
];

export function BrowserSettingsButton() {
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="relative flex">
    <button title="Settings" aria-label="Settings" aria-haspopup="dialog"
      className="flex items-center justify-center px-2 py-1.5 rounded-md border border-[var(--av-202e3b)] bg-[var(--av-0f141b)] text-gray-400 hover:text-gray-200 hover:bg-[var(--av-1a232f)] transition-colors"
      onClick={(event) => {
        const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
        if (!('__TAURI_INTERNALS__' in window)) { setError('Settings are available in the desktop app.'); return; }
        void invoke('toggle_browser_settings', { anchor: { x, y, width, height } }).catch((e) => {
          setError(String(e)); clearTimeout(timer.current); timer.current = setTimeout(() => setError(''), 5000);
        });
      }}><Settings className="w-3.5 h-3.5" /></button>
    {error && <span role="alert" className="absolute right-0 top-full z-50 mt-2 w-64 rounded border border-red-800 bg-[var(--av-151e28)] p-3 text-xs text-red-300">{error}</span>}
  </div>;
}

export function BrowserSettingsWindow() {
  const [settings, setSettings] = useState<SettingsData>();
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [busy, setBusy] = useState<Cleanup | 'toggle' | 'adblock' | null>(null);
  const [done, setDone] = useState<Partial<Record<Cleanup, boolean>>>({});
  const [error, setError] = useState('');
  const timers = useRef<Partial<Record<Cleanup, ReturnType<typeof setTimeout>>>>({});
  const locked = useRef(false);
  useEffect(() => {
    let disposed = false;
    const load = () => { setTheme(readTheme()); return invoke<SettingsData>('get_browser_settings').then((value) => { if (!disposed) setSettings(value); }).catch((e) => { if (!disposed) setError(String(e)); }); };
    void load();
    window.addEventListener('focus', load);
    return () => { disposed = true; window.removeEventListener('focus', load); Object.values(timers.current).forEach(clearTimeout); };
  }, []);
  const close = () => { void invoke('close_browser_settings').catch(console.error); };
  const run = async (action: Cleanup) => {
    if (locked.current) return;
    locked.current = true; setBusy(action); setError('');
    clearTimeout(timers.current[action]); setDone((previous) => ({ ...previous, [action]: false }));
    try {
      await invoke('clear_browser_data', { action });
      setDone((previous) => ({ ...previous, [action]: true }));
      timers.current[action] = setTimeout(() => setDone((previous) => ({ ...previous, [action]: false })), 5000);
    } catch (e) { setError(String(e)); }
    finally { locked.current = false; setBusy(null); }
  };
  const toggle = async () => {
    if (!settings || locked.current) return;
    locked.current = true; setBusy('toggle'); setError('');
    try { setSettings(await invoke<SettingsData>('set_keep_history', { enabled: !settings.keepHistory })); }
    catch (e) { setError(String(e)); try { setSettings(await invoke<SettingsData>('get_browser_settings')); } catch { /* Keep the original error visible. */ } }
    finally { locked.current = false; setBusy(null); }
  };
  const toggleAdblock = async () => {
    if (!settings || locked.current) return;
    locked.current = true; setBusy('adblock'); setError('');
    try { setSettings(await invoke<SettingsData>('set_adblock_enabled', { enabled: !settings.adblockEnabled })); }
    catch (e) { setError(String(e)); try { setSettings(await invoke<SettingsData>('get_browser_settings')); } catch { /* Keep the original error visible. */ } }
    finally { locked.current = false; setBusy(null); }
  };
  return <section role="dialog" aria-label="Browser settings" className="h-screen overflow-auto rounded-md border border-[var(--av-374151)] bg-[var(--av-111923)] p-2 text-gray-200 text-xs" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
    <header className="flex items-center justify-between px-2 pb-1"><span className="font-semibold">Settings</span><button onClick={close} title="Close settings" className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" /></button></header>
    <button onClick={() => { void invoke('open_browser_history').catch((e) => setError(String(e))); }} className="flex items-center gap-3 w-full p-2.5 rounded hover:bg-white/5 text-left"><Clock className="w-4 h-4 text-cyan-400" /><span>History</span><span className="ml-auto text-gray-500">View visited pages</span></button>
    <div className="my-1 border-t border-[var(--av-293545)]" />
    {actions.map(({ id, label, description, icon: Icon }) => <button key={id} disabled={!!busy} onClick={() => { void run(id); }}
      className={`flex w-full gap-3 rounded p-2.5 text-left transition-colors disabled:cursor-wait ${done[id] ? 'bg-emerald-950/70 text-emerald-300' : 'hover:bg-white/5'}`}>
      {busy === id ? <LoaderCircle className="w-4 h-4 shrink-0 mt-0.5 animate-spin" /> : done[id] ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <Icon className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />}
      <span><span className="block font-medium">{done[id] ? `${label} — done` : label}</span><span className={`block mt-1 text-[11px] leading-4 ${done[id] ? 'text-emerald-400' : 'text-gray-400'}`}>{description}</span></span>
    </button>)}
    <div className="my-1 border-t border-[var(--av-293545)]" />
    <button role="switch" aria-label="Keep URL history" aria-checked={settings?.keepHistory ?? true} disabled={!settings || !!busy} onClick={() => { void toggle(); }} className="flex w-full items-start gap-3 rounded p-2.5 text-left hover:bg-white/5 disabled:opacity-60">
      <Clock className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
      <span className="flex-1"><span className="block font-medium">Keep URL history</span><span className="block text-gray-400 text-[11px] leading-4 mt-1">Off removes saved URL history and clears new visits automatically, on startup and when closing. Keeps cookies and logins.</span></span>
      <span className={`relative shrink-0 w-8 h-[18px] mt-0.5 rounded-full transition-colors ${(settings?.keepHistory ?? true) ? 'bg-emerald-600' : 'bg-gray-600'}`}><span className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${(settings?.keepHistory ?? true) ? 'translate-x-3.5' : ''}`} /></span>
    </button>
    <button role="switch" aria-label="Ad blocking" aria-checked={settings?.adblockEnabled ?? true} disabled={!settings || !!busy} onClick={() => { void toggleAdblock(); }} className="flex w-full items-start gap-3 rounded p-2.5 text-left hover:bg-white/5 disabled:opacity-60">
      <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
      <span className="flex-1"><span className="block font-medium">Ad blocking</span><span className="block text-gray-400 text-[11px] leading-4 mt-1">Blocks ads and trackers. Reload pages after changing. Local AI apps are excluded.</span></span>
      <span className={`relative shrink-0 w-8 h-[18px] mt-0.5 rounded-full transition-colors ${(settings?.adblockEnabled ?? true) ? 'bg-emerald-600' : 'bg-gray-600'}`}><span className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${(settings?.adblockEnabled ?? true) ? 'translate-x-3.5' : ''}`} /></span>
    </button>
    <div className="my-1 border-t border-[var(--av-293545)]" />
    <div className="p-2.5">
      <div className="flex items-center gap-3 font-medium"><Palette className="w-4 h-4" style={{ color: 'var(--theme-accent)' }} />Theme</div>
      <div role="radiogroup" aria-label="Theme" className="mt-3 flex flex-wrap gap-3 pl-7">
        {themes.map((choice) => <button key={choice.id} role="radio" aria-label={choice.name} aria-checked={theme === choice.id} title={choice.name}
          onClick={() => { try { saveTheme(choice.id); setTheme(choice.id); setError(''); } catch { setError('Unable to save theme. Please try again.'); } }}
          className="relative h-8 w-8 rounded-full border border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{ background: `linear-gradient(135deg, ${choice.base} 50%, ${choice.accent} 50%)` }}>
          {theme === choice.id && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-md" />}
        </button>)}
      </div>
    </div>
    {error && <p role="alert" className="m-2 text-red-300 break-words">{error}</p>}
  </section>;
}

interface Visit { id: number; url: string; title: string; visitedAt: number }
interface HistoryData { visits: Visit[]; more: boolean }
export function BrowserHistoryWindow() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<HistoryData>({ visits: [], more: false });
  const [settings, setSettings] = useState<SettingsData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let disposed = false; const stops: (() => void)[] = [];
    for (const name of ['browser-history-cleared', 'browser-settings-changed']) void listen(name, () => { setOffset(0); setVersion((v) => v + 1); }).then((stop) => { if (disposed) stop(); else stops.push(stop); });
    const focus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', focus);
    return () => { disposed = true; stops.forEach((stop) => stop()); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    let disposed = false; setLoading(true); setError('');
    void Promise.all([invoke<HistoryData>('list_browser_history', { search: query, offset }), invoke<SettingsData>('get_browser_settings')]).then(([next, prefs]) => {
      if (!disposed) { setData(next); setSettings(prefs); }
    }).catch((e) => { if (!disposed) { setError(String(e)); setData({ visits: [], more: false }); } }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [query, offset, version]);
  return <main className="h-screen overflow-auto bg-[var(--av-090c10)] text-gray-200 select-text">
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-center justify-between mb-5"><div><h1 className="flex gap-3 items-center text-2xl font-semibold"><Clock className="w-6 h-6 text-cyan-400" />History</h1><p className="text-sm text-gray-400 mt-2">Pages visited in AuraView · newest first · times shown in your local time zone</p></div><button onClick={() => setVersion((v) => v + 1)} className="rounded border border-[var(--av-293545)] px-3 py-2 text-xs hover:bg-white/5">Refresh</button></header>
      <input aria-label="Search browsing history" placeholder="Search titles or URLs…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-[var(--av-293545)] bg-[var(--av-111923)] px-4 py-3 mb-5 text-sm outline-none focus:border-cyan-600" />
      {settings && !settings.keepHistory && <p className="mb-4 text-amber-300 text-sm">URL history is turned off. New visits are cleared automatically. Enable “Keep URL history” in Settings to retain visits.</p>}
      {error && <p role="alert" className="mb-4 text-red-300 text-sm">{error}</p>}
      {loading ? <p role="status" className="py-10 text-gray-400">Loading history…</p> : !data.visits.length ? <p className="py-10 text-gray-500">{query ? 'No matching visits.' : 'No browsing history.'}</p> : <ol className="space-y-1">
        {data.visits.map((visit) => <li key={visit.id} className="flex gap-4 items-start rounded-lg px-3 py-3 hover:bg-white/5 border-b border-white/5">
          <time dateTime={new Date(visit.visitedAt).toISOString()} className="shrink-0 w-44 text-xs text-gray-400 pt-1">{new Date(visit.visitedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}</time>
          <button onClick={() => { void invoke('open_history_url', { url: visit.url }).catch((e) => setError(String(e))); }} className="min-w-0 text-left"><span className="block text-sm text-cyan-300 break-words">{visit.title || visit.url}</span><span className="block text-xs text-gray-500 break-all mt-1">{visit.url}</span></button>
        </li>)}
      </ol>}
      <nav aria-label="History pages" className="flex justify-between mt-6 text-xs"><button disabled={offset === 0 || loading} onClick={() => setOffset((v) => Math.max(0, v - 200))} className="rounded border border-[var(--av-293545)] px-3 py-2 disabled:opacity-30">Newer visits</button><button disabled={!data.more || loading} onClick={() => setOffset((v) => v + 200)} className="rounded border border-[var(--av-293545)] px-3 py-2 disabled:opacity-30">Older visits</button></nav>
    </div>
  </main>;
}
