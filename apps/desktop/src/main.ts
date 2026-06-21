// Electron main process: spawn the daemon (unless an external one is running), wait for its
// health, then open the window pointed at the web app.
//
// NOTE: This file is Electron-only — its window behavior must be verified on a real desktop
// (Windows 11 per the plan); CI exercises only the platform-neutral helpers it imports.

import { app, BrowserWindow } from 'electron';
import { startDaemon, type DaemonHandle } from './daemon-process.js';
import { waitForHealth } from './health-wait.js';

const DAEMON_PORT = Number(process.env.PORT ?? 4319);
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
// In `pnpm dev` the daemon is already running (turbo), so don't spawn a second one.
const DAEMON_EXTERNAL = process.env.DAEMON_EXTERNAL === '1';

let daemon: DaemonHandle | undefined;

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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await loadWebWithRetry(win, WEB_URL);
}

app
  .whenReady()
  .then(async () => {
    if (!DAEMON_EXTERNAL) daemon = startDaemon({ port: DAEMON_PORT });
    await waitForHealth(`http://127.0.0.1:${DAEMON_PORT}/api/health`);
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
