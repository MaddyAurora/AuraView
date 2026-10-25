# 🌌 AuraView

> **A lightweight, high-performance custom browser designed for entertainment, AI applications, power workflows, and media playback.**

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.2-blue?logo=tauri)](https://v2.tauri.app/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ⚡ Why AuraView?

Modern browsers like Chrome and Edge frequently consume **1 GB to 3+ GB of RAM** and allocate shared GPU memory for background tabs. When running local AI servers—such as **ComfyUI**, **Gradio**, **Ollama**, or **vLLM**—every megabyte of RAM and VRAM matters.

**AuraView** solves this by pairing a high-efficiency **Tauri v2** shell with the system's native **WebView2 (Chromium)** engine:
* **Minimal Footprint:** Idles around **~30–60 MB RAM**, leaving your hardware resources dedicated to local inference and training.
* **Instant Port Navigation:** Type `8188` or `7860` in the address bar and jump straight to your local server.
* **Video & Media Accelerated:** Full hardware-accelerated playback for **YouTube**, embedded streams, and AI video previews.

---

## ✨ Features

- 🚀 **Local AI Hub:** Pre-configured 1-click dock for popular AI interfaces:
  - **ComfyUI** (`:8188`)
  - **Gradio / SD WebUI** (`:7860`)
  - **Ollama API** (`:11434`)
  - **Pinokio** (`:42000`)
  - Quick custom port launcher (`:8000`, `:5000`, etc.)
  Right-click the AI Dock for **Add port…**, or right-click an entry for **Edit entry…** and
  **Delete entry**. The editor supports a name, localhost port, optional description, and dot color
  from presets or a custom color picker. Changes, including removal of default entries, persist
  across restarts. Drag Dock entries left or right to reorder them; the order is saved too.
- 🪟 **Side-by-Side Split View:** Compare pages side-by-side (`Ctrl + \`).
- **Image downloader:** Hover over a loaded image to reveal a small download button in its
  bottom-right corner. Click to save the original image to the Windows Downloads folder. Existing
  filenames receive a numbered suffix. The button shows a check mark when saved or a retry hint on
  failure. Works with linked, responsive, generated blob/data images, single CSS backgrounds, and
  embedded frames, including split tabs.
  The button appears only on images displayed at least 120 × 120 pixels in size.
- **Video downloader:** Hover overa loaded video to reveal a download button in its
  top-right corner. Paused videos, transparent player covers, embedded frames, split panes, and player fullscreen are supported. Click to download; click again during a download to cancel.
  Instagram story videos resolve through the open tab's login, including stories opened from Home
  with only an account URL. Downloads match that player's media ID or poster to the selected story.
  Image and video download overlays hide after three seconds without pointer movement, including
  fullscreen playback, and reappear when the pointer moves. Keyboard-focused download actions stay visible.
- **Downloads:** The Downloads toolbar panel lists images, videos, and browser file downloads
  together for the current app session, with progress and completion status. Active files can be
  cancelled; interrupted files can be resumed when the browser supports it. Image failures can be
  retried from the image's download button. The toolbar button fills green with combined download
  progress and shows a green check for five seconds after completion. Hover to preview history;
  click to pin it open, and click again to close. Hover previews overlay the page without resizing
  it; the pinned history resizes the page area.
  Active transfers show their average speed and an approximate time remaining when the size is
  known. Estimates appear after progress can be measured and clear during merging, saving, or a stall.
  Completed downloads have **Show in folder**, **Download again** (a numbered new copy), and
  **Delete file** (Recycle Bin) actions. Deleted entries
  stay in history for downloading again; generated files may need their original page kept open.
  Checks: `http://localhost:1420/tests/fixtures/downloads.html`.
- **Toolbar visibility:** The bookmarks bar and AI Dock independently remember whether they are
  shown or hidden across app restarts, including AI Dock changes made with its keyboard shortcut.
  Clearing browser history, cookies, or login sessions preserves these preferences.
- **Built-in ad blocking:** Enabled by default, with a persistent **Ad blocking** switch in the
  gear Settings menu. Uses Brave's native Rust filtering engine with EasyList and EasyPrivacy to
  block ad/tracker requests and hide matching page elements, including dynamically added ads
  and embedded frames. Local AI apps and private-network resources are excluded. Reload pages
  after changing the setting to restore previously blocked resources or remove already-loaded ads.
  Bundled lists work offline; validated HTTPS updates run in the background at most daily while
  enabled. Failed updates keep existing protection. YouTube player responses and Instagram feed
  responses also receive site-specific filtering before page scripts consume them, including
  initial page data and later fetch/XHR requests. Recognized YouTube ad placements and Instagram
  sponsored entries are removed while ordinary video metadata, posts and login cookies are kept.
  Instagram sponsored labels have a DOM fallback; recycled ordinary posts become visible again.
  YouTube's visible Skip ad controls are used only while its player explicitly reports an ad.
  Embedded sponsorships inside a creator's video and all server-side ad variants are not covered.
  This is an independent blocker, not full
  uBlock Origin: uBO scriptlets, procedural filters, the dynamic firewall, worker-only traffic,
  and WebSocket filtering are not included. WebView2 can also omit deeply nested cross-origin
  requests from its interception event ([upstream issue](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5765));
  cosmetic hiding still works in those frames. Some video ads and anti-adblock systems can remain.
  Sources, licenses, and scope: [ad blocking notices](src-tauri/resources/adblock/NOTICE.md).
- **Settings and history:** Click the gear to the right of **Split**. **History** opens a searchable
  page of visited URLs and titles, newest first, with local date/time stamps and older/newer pages.
  **Clear browser history** removes visited URLs and native download records plus completed entries
  in Downloads; cookies, logins, downloaded files, and active transfers are kept. **Clear cookies**
  removes cookies and reloads open pages, which may sign you out. **Clear login sessions** also
  removes website storage and clears open pages' session storage before reloading; bookmarks and
  AI Dock entries are backed up and restored. Cleanup buttons turn green for five seconds after
  successful completion. **Keep URL history** is saved across restarts. Turning it off removes
  existing URL history and clears new visits after navigation, on startup, and before normal exit.
  This uses WebView2's history-clearing API; visits can briefly reach disk before cleanup, and a
  forced termination can leave records until the next startup. Cookies and logins remain enabled.
- **Bookmarks:** Click the bookmark icon to the left of **AI Dock** to toggle the bookmarks bar.
  Click a toolbar folder again to close it. Right-click a folder for **Delete folder**, which removes
  that folder and its contained bookmarks and subfolders.
  Right-click the bar for **Import bookmarks…** and **Export bookmarks…**. Import Chrome/Edge
  bookmarks HTML files without replacing existing bookmarks; nested folders, ordering, and Unicode
  titles are preserved. Exports use the same HTML format for importing into Chrome or Edge.
  AuraView imports HTTP(S) links and reports skipped bookmarklets or browser-internal pages.
- 🧠 **Smart Address Bar:** Intelligently identifies raw ports (`8188`), `localhost`, web URLs (`youtube.com`), or web search queries.
- 🎬 **Hardware Video Playback:** Full support for HTML5 video, VP9, AV1, and YouTube media streaming.
- ⌨️ **Productivity Hotkeys:**
  - `Ctrl + T`: New tab
  - `Ctrl + F4` / `Ctrl + W`: Close active tab (the last tab stays open)
  - `Ctrl + Shift + F4`: Reopen the last closed tab, including split URLs and layout
  - `Ctrl + Tab` / `Ctrl + Shift + Tab`: Next / previous tab (wraps around)
  - `Ctrl + 1` through `Ctrl + 8`: Select numbered tab; `Ctrl + 9`: Last tab
  - `Esc`: Stop loading (also dismisses native find/dialog UI)
  - `Ctrl + R` / `Ctrl + F5` / `F5`: Reload page
  - `Ctrl + F`: Find on page; `Ctrl + G` / `Ctrl + Shift + G`: Next / previous match
  - `Space` / `Shift + Space`: Scroll down / up, with normal input and media behavior
  - `Ctrl + P`: Print; `Ctrl + S`: Save page using the native Save As dialog
  - `F11`: Toggle fullscreen; `F12`: Toggle the active page's developer tools
  - `Ctrl + \`: Toggle split-screen view
  - `Ctrl + D`: Toggle Local AI Dock

Desktop shortcuts work from app controls and web content. Page commands use the last focused visible
pane in split view. Closed tabs are remembered for this session (up to 20); reopening reloads their
URLs with new navigation history. The browser-only Vite preview does not provide native page actions.

Video/player fullscreen fills the display with the player and restores the previous window and
split layout on exit. `F11` browser fullscreen keeps the tabs and address bar visible.

---

## 🛠️ Tech Stack

* **Desktop Shell:** [Tauri v2](https://v2.tauri.app/) (Rust)
* **Frontend UI:** [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
* **Build System:** [Vite 6](https://vitejs.dev/)
* **Styling & Icons:** [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)

---


### Installation
Just download and install the latest binary executable at https://github.com/MaddyAurora/AuraView/releases

### Desktop development

Run `npm install`, then `npm run tauri -- dev` (or `start-desktop-dev.bat`). The first desktop run
downloads the video helpers from official releases and verifies their pinned SHA-256 checksums.
Subsequent launches verify and reuse the local copies. Release builds bundle the same tools, so
installed users do not need Python, FFmpeg, or Deno on their PATH. The Vite-only preview (`npm run dev`)
does not provide native download actions.

Helper versions and archive checksums are in `scripts/video-tools.json`. To update the engine,
review the new official release, update its version, URL, and checksum there, then run
`npm run prepare:video-tools`. The script replaces changed tools and refreshes its verification receipt.
See `src-tauri/resources/download-tools/NOTICE.md` for helper licenses and source links.

Validation: `npm run build`, `node --test tests/*.test.mjs`, and
`cargo test --manifest-path src-tauri/Cargo.toml --lib`.

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
