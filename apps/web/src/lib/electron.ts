// Access to the Electron preload bridge (window.hsw). Present ONLY inside the desktop shell — in a
// plain browser it's absent, so image features degrade gracefully (getBridge() returns null).

export interface HswBridge {
  saveImageConfig: (cfg: { baseURL: string; model: string; apiKey: string }) => Promise<void>;
  imageConfigStatus: () => Promise<{ configured: boolean; baseURL?: string; model?: string }>;
  generateImage: (req: { projectId: string; prompt: string }) => Promise<{ html: string; name: string }>;
  exportPdf: (req: { projectId: string; title: string }) => Promise<{ saved: boolean; path?: string }>;
}

declare global {
  interface Window {
    hsw?: HswBridge;
  }
}

export function getBridge(): HswBridge | null {
  return typeof window !== 'undefined' && window.hsw ? window.hsw : null;
}
