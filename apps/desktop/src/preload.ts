// Preload bridge — the ONLY surface the renderer (web app) can reach in the main process. Narrow
// by design: config save/status + image generation. The renderer never receives the API key back
// (imageConfigStatus returns only configured/baseURL/model). contextIsolation keeps this isolated.

import { contextBridge, ipcRenderer } from 'electron';

export interface ImageConfigInput {
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface GenerateImageRequest {
  projectId: string;
  prompt: string;
}

const api = {
  saveImageConfig: (cfg: ImageConfigInput): Promise<void> => ipcRenderer.invoke('hsw:saveImageConfig', cfg),
  imageConfigStatus: (): Promise<{ configured: boolean; baseURL?: string; model?: string }> =>
    ipcRenderer.invoke('hsw:imageConfigStatus'),
  generateImage: (req: GenerateImageRequest): Promise<{ html: string; name: string }> =>
    ipcRenderer.invoke('hsw:generateImage', req),
};

contextBridge.exposeInMainWorld('hsw', api);

export type HswBridge = typeof api;
