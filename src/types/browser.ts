export type BrowserPane = 'primary' | 'secondary';

export interface BrowserViewRef {
  tabId: string;
  pane: BrowserPane;
}

export interface Tab {
  id: string;
  title: string;
  url: string;
  inputUrl: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isMuted?: boolean;
  isAiServer?: boolean;
  splitEnabled?: boolean;
  splitReversed?: boolean;
  splitRatio?: number;
  split?: Tab;
  view?: BrowserViewRef;
}

export interface AIServerBookmark {
  id: string;
  name: string;
  port: number;
  path?: string;
  badge: string;
  color: string;
  description: string;
}

export const DEFAULT_AI_SERVERS: AIServerBookmark[] = [
  {
    id: 'comfyui',
    name: 'ComfyUI',
    port: 8188,
    badge: 'Node / Diffusion',
    color: 'from-amber-500 to-orange-600',
    description: 'Local node-based Stable Diffusion & FLUX workflow generator',
  },
  {
    id: 'ollama-webui',
    name: 'Open WebUI',
    port: 3000,
    badge: 'LLM Chat',
    color: 'from-cyan-500 to-blue-600',
    description: 'Chat interface for local Ollama, vLLM, and HuggingFace models',
  },
  {
    id: 'ollama-api',
    name: 'Ollama API',
    port: 11434,
    badge: 'API Engine',
    color: 'from-emerald-500 to-teal-600',
    description: 'Local LLM inference server status & endpoints',
  },
  {
    id: 'pinokio',
    name: 'Pinokio',
    port: 42000,
    badge: 'AI Browser',
    color: 'from-purple-500 to-indigo-600',
    description: 'Autonomous AI browser & model runner dashboard',
  },
];
