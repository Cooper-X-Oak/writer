// Electron main process: spawn the daemon (unless an external one is running), wait for its
// health, then open the window pointed at the web app.
//
// NOTE: This file is Electron-only — its window behavior must be verified on a real desktop
// (Windows 11 per the plan); CI exercises only the platform-neutral helpers it imports.

import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { startDaemon, type DaemonHandle } from './daemon-process.js';
import { waitForHealth } from './health-wait.js';
import {
  saveImageConfig,
  loadImageConfig,
  imageConfigStatus,
  type ConfigCrypto,
  type StoredImageConfig,
} from './image-config.js';
import { generateImage } from './image-gen.js';

const DAEMON_PORT = Number(process.env.PORT ?? 4319);
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
// In `pnpm dev` the daemon is already running (turbo), so don't spawn a second one.
const DAEMON_EXTERNAL = process.env.DAEMON_EXTERNAL === '1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(app.getPath('userData'), 'image-config.json');

// The BYOK key is encrypted at rest with the OS-backed key store (DPAPI on Windows / Keychain on
// macOS) — never plaintext on disk, never in logs.
const safeCrypto: ConfigCrypto = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
};

let daemon: DaemonHandle | undefined;

function registerImageIpc(): void {
  ipcMain.handle('hsw:imageConfigStatus', () => imageConfigStatus(CONFIG_PATH));

  ipcMain.handle('hsw:saveImageConfig', async (_e, cfg: StoredImageConfig) => {
    if (!cfg || typeof cfg.baseURL !== 'string' || typeof cfg.model !== 'string' || typeof cfg.apiKey !== 'string') {
      throw new Error('invalid image config');
    }
    await saveImageConfig(CONFIG_PATH, safeCrypto, cfg);
  });

  ipcMain.handle('hsw:generateImage', async (_e, req: { projectId?: unknown; prompt?: unknown }) => {
    const projectId = typeof req?.projectId === 'string' ? req.projectId : '';
    const prompt = typeof req?.prompt === 'string' ? req.prompt.trim() : '';
    if (!projectId || !prompt) throw new Error('projectId and prompt are required');

    const cfg = await loadImageConfig(CONFIG_PATH, safeCrypto);
    if (!cfg) throw new Error('image provider is not configured');

    const img = await generateImage(cfg, prompt);
    const url = `http://127.0.0.1:${String(DAEMON_PORT)}/api/projects/${encodeURIComponent(projectId)}/image?alt=${encodeURIComponent(prompt.slice(0, 80))}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': img.contentType }, body: img.bytes });
    if (!res.ok) throw new Error(`saving the image failed: ${String(res.status)}`);
    return (await res.json()) as { html: string; name: string };
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadWebWithRetry(win: BrowserWindow, url: string, attempts = 40, delayMs = 300): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await win.loadURL(url);
      return;
    } catch {
      await sleep(delayMs);
    }
  }
  throw new Error(`web app not reachable: ${url}`);
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
    },
  });
  await loadWebWithRetry(win, WEB_URL);
}

app
  .whenReady()
  .then(async () => {
    if (!DAEMON_EXTERNAL) daemon = startDaemon({ port: DAEMON_PORT });
    await waitForHealth(`http://127.0.0.1:${DAEMON_PORT}/api/health`);
    registerImageIpc();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((err: unknown) => {
    console.error('[desktop] startup failed:', err);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function cleanup(): void {
  daemon?.stop();
}
app.on('before-quit', cleanup);
process.on('exit', cleanup);
