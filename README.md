# 🌌 AuraView

> **A lightweight, high-performance custom browser designed for entertainment, local servers hub, with image and video download features.**

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.2-blue?logo=tauri)](https://v2.tauri.app/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ⚡ Why AuraView?

AuraView is designed to offer a fast, lightweight browsing experience without the resource overhead of traditional browsers.

Built with Tauri v2 and Microsoft Edge WebView2, it is especially useful for running local AI interfaces, watching media, and multitasking.

* **Minimal Footprint:** Typically uses around 30–60 MB RAM when idle.
* **Instant Port Navigation:** Quickly access ComfyUI, Gradio, Ollama, and other local servers.
* **Video & Media Accelerated:** Smooth video playback using your GPU.
* **Video and Image downloader** Features buttons to the right of images and videos for quick download, with resolution selector or audio only download.

---

## ✨ Features

- 🚀 **Local Hub:** Quickly launch local AI services using customizable shortcuts, ports, and drag-and-drop ordering.
- 🪟 **Side-by-Side Split View:** Browse two websites side by side in the same tab.
- **Media Downloader:** Download images and videos directly from supported websites, including embedded media with the available resolutions selector or audio mp3 download only.
- **Downloads Manager:** Track downloads, monitor progress, cancel or resume transfers, and manage downloaded files.
- **Built-in Ad Blocking:** Blocks many ads and trackers using Brave's filtering engine, EasyList, and EasyPrivacy.
- **Bookmarks:** Organize your favorite websites into folders, with Chrome and Edge import/export support.
- 🧠 **Smart Address Bar:** Automatically recognizes websites, search queries, localhost addresses, and port numbers.
- 🎬 **Video Playback:** Hardware-accelerated support for HTML5 video, YouTube, VP9, and AV1.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close tab |
| `Ctrl + Shift + F4` | Reopen closed tab |
| `Ctrl + Tab` | Next tab |
| `Ctrl + Shift + Tab` | Previous tab |
| `Ctrl + 1–9` | Switch tabs |
| `Ctrl + R` / `F5` | Reload page |
| `Ctrl + F` | Find on page |
| `Ctrl + P` | Print page |
| `Ctrl + S` | Save page |
| `Ctrl + \` | Toggle Split View |
| `Ctrl + D` | Toggle Local Hub |
| `F11` | Fullscreen |
| `F12` | Developer Tools |

---

## 📥 Installation

Download the latest Windows release and install AuraView:

**[Download AuraView](https://github.com/MaddyAurora/AuraView/releases)**

---

### Development

Clone the repository and install dependencies:

```bash
npm install
```

Launch the desktop application:

```bash
npm run tauri -- dev
```

Alternatively, use `start-desktop-dev.bat`.

For frontend-only development:

```bash
npm run dev
```

*Note: Native features such as media downloads require the Tauri desktop application.*

---

## 🛠️ Built With

- **Tauri v2** + Rust: Desktop framework
- **React 18** + TypeScript: User interface
- **Vite 6**: Frontend tooling
- **Tailwind CSS**: Styling
- **Lucide Icons**: Interface icons
- **WebView2**: Chromium-based browser engine

---

## 📄 License

AuraView is open-source software distributed under the [MIT License](LICENSE).
