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
- 🪟 **Side-by-Side Split View:** Compare pages side-by-side (`Ctrl + \`).
- **Image downloader:** Hover over a loaded image to reveal a small download button in its
  bottom-right corner. Click to save the original image to the Windows Downloads folder. Existing
  filenames receive a numbered suffix. The button shows a check mark when saved or a retry hint on
  failure. Works with linked, responsive, generated blob/data images, single CSS backgrounds, and
  embedded frames, including split tabs.
- **Video downloader:** Hover overa loaded video to reveal a download button in its
  top-right corner. Paused videos, transparent player covers, embedded frames, split panes, and player fullscreen are supported. Click to download; click again during a download to cancel.
- **Bookmarks:** Click the bookmark icon to the left of **AI Dock** to toggle the bookmarks bar.
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
