# 🌌 AuraView

> **A lightweight, high-performance custom browser designed specifically for local AI applications, power workflows, and media playback.**

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
- **Tab overflow:** Tabs shrink to fit, then complete extra tabs move into a numbered dropdown.
  Hover or click the count to select a hidden tab; linked split tabs stay together.
- **Middle-click tabs:** Click the mouse wheel on a tab to close it. In a split, only the clicked page
  closes; the other page becomes a normal tab and keeps its history and playback.
- **Tab context menu:** Right-click a tab to **Refresh**, **Duplicate tab**, **Mute tab** / **Unmute tab**,
  **Close page**, **Close tabs to the right**, **Close tabs to the left**, or **Reopen closed tab**.
  Refresh, duplicate, mute, and Close page target the clicked page, including a background or split page.
  Duplicates open beside the original group with fresh navigation history. Closing tabs to either side
  keeps the clicked split pair together; closed groups can be reopened with their layout and mute state.
- **Hover image downloads (desktop):** Hover a loaded image to reveal a small download button in its
  bottom-right corner. Click to save the original image to the Windows Downloads folder. Existing
  filenames receive a numbered suffix. The button shows a check mark when saved or a retry hint on
  failure. Works with linked, responsive, generated blob/data images, single CSS backgrounds, and
  embedded frames, including split tabs. Images loaded later while scrolling can also be saved through
  the browser's session when their cached data is unavailable. Transparent gallery covers and images
  with mouse events disabled are supported; carousels target the visible slide. Very small images without room for a button are skipped.
  To check the feature in desktop dev, open `http://localhost:1420/tests/fixtures/image-download.html`.
  Scrolling and lazy-feed checks are at `http://localhost:1420/tests/fixtures/image-download-feed.html`.
- **Bookmarks:** Click the bookmark icon to the left of **AI Dock** to toggle the bookmarks bar.
  Right-click the bar and choose **Add current page…**, or click its **+** button. Edit the prefilled
  title and link, then choose **Root**, **Create folder…**, or an existing folder. Root bookmarks
  appear directly on the bar; folders open a menu of their saved pages. Bookmarks and folders are
  saved locally across restarts. In split view, bookmarking uses the last focused visible page.
  Right-click a bookmark to edit, delete, or open it in a new tab; Ctrl-click or middle-click also
  opens a bar bookmark in a new tab. Folder menus show saved pages and **Add current page…**;
  right-click a page inside the folder for **Edit** or **Delete**. Drag bookmarks and folders to
  reorder the bar, and drag pages within a folder to reorder them. The order is saved locally.
  The desktop bookmark editor opens in a small owned window, leaving the browser page visible
  behind it without dimming or replacing the page.
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

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
