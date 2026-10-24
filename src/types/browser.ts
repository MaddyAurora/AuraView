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
    color: '#f59e0b',
    description: 'Local node-based Stable Diffusion & FLUX workflow generator',
  },
  {
    id: 'ollama-webui',
    name: 'Open WebUI',
    port: 3000,
    badge: 'LLM Chat',
    color: '#06b6d4',
    description: 'Chat interface for local Ollama, vLLM, and HuggingFace models',
  },
  {
    id: 'ollama-api',
    name: 'Ollama API',
    port: 11434,
    badge: 'API Engine',
    color: '#10b981',
    description: 'Local LLM inference server status & endpoints',
  },
  {
    id: 'pinokio',
    name: 'Pinokio',
    port: 42000,
    badge: 'AI Browser',
    color: '#a855f7',
    description: 'Autonomous AI browser & model runner dashboard',
  },
];
