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
* **GPU & VRAM Preservation:** Built-in **VRAM Saver** mode prevents idle tabs from locking graphics memory.
* **Instant Port Navigation:** Type `8188` or `7860` in the address bar and jump straight to your local server.
* **Video & Media Accelerated:** Full hardware-accelerated playback for **YouTube**, embedded streams, and AI video previews.

---

## ✨ Features

- 🚀 **Local AI Hub:** Pre-configured 1-click dock for popular AI interfaces:
  - **ComfyUI** (`:8188`)
  - **Gradio / SD WebUI** (`:7860`)
  - **Open-WebUI** (`:3000`)
  - **Ollama API** (`:11434`)
  - **Pinokio** (`:42000`)
  - **JoyCaption** (`:7861`)
  - Quick custom port launcher (`:8000`, `:5000`, etc.)
- 🪟 **Side-by-Side Split View:** Compare diffusion outputs side-by-side or run a chat model next to an image generator (`Ctrl + \`).
- 🧠 **Smart Address Bar:** Intelligently identifies raw ports (`8188`), `localhost`, web URLs (`youtube.com`), or web search queries.
- 🎬 **Hardware Video Playback:** Full support for HTML5 video, VP9, AV1, and YouTube media streaming.
- 🛡️ **VRAM Saver:** Throttles idle and background webviews to protect GPU resources.
- ⌨️ **Productivity Hotkeys:**
  - `Ctrl + T`: New tab
  - `Ctrl + W`: Close active tab
  - `Ctrl + R`: Reload page
  - `Ctrl + \`: Toggle split-screen view
  - `Ctrl + D`: Toggle Local AI Dock

---

## 🛠️ Tech Stack

* **Desktop Shell:** [Tauri v2](https://v2.tauri.app/) (Rust)
* **Frontend UI:** [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
* **Build System:** [Vite 6](https://vitejs.dev/)
* **Styling & Icons:** [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher)
* [Rust](https://www.rust-lang.org/) (Required for local native `.exe` compilation):
  ```powershell
  winget install Rustlang.Rustup
  ```

### 1. Installation
```powershell
git clone https://github.com/MaddyAurora/AuraView.git
cd AuraView
npm install
```

### 2. Frontend Development Mode (Runs in browser preview)
```powershell
npm run dev
```

### 3. Native Desktop Development (Runs with Tauri v2)
```powershell
npm run tauri dev
```

### 4. Build Release Executable
```powershell
npm run tauri build
```
The compiled `.exe` installer will be located in:
`src-tauri/target/release/bundle/`

---

## 📦 Automated GitHub Releases

This repository includes a pre-configured GitHub Actions workflow (`.github/workflows/release.yml`). 

Whenever you push a version tag, GitHub automatically compiles the native Windows `.exe` and attaches it to your **GitHub Releases** page:
```powershell
git tag v0.1.0
git push origin v0.1.0
```

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
