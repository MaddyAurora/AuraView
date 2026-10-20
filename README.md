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
- 🧠 **Smart Address Bar:** Intelligently identifies raw ports (`8188`), `localhost`, web URLs (`youtube.com`), or web search queries.
- 🎬 **Hardware Video Playback:** Full support for HTML5 video, VP9, AV1, and YouTube media streaming.
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


### Installation
Just download and install the latest binary executable at https://github.com/MaddyAurora/AuraView/releases

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
