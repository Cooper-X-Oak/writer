// BYOK image-provider config persistence. The API key is the ONLY secret; it is encrypted at rest
// via an injected crypto (Electron safeStorage in production — OS-backed DPAPI/Keychain). baseURL
// and model are not secret and stored in clear. The key is NEVER returned by the status query and
// NEVER logged. The crypto is injectable so this logic is unit-tested without Electron.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StoredImageConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

/** Safe to expose to the renderer — never includes the key. */
export interface ImageConfigStatus {
  configured: boolean;
  baseURL?: string;
  model?: string;
}

export interface ConfigCrypto {
  available: () => boolean;
  /** plaintext → base64 ciphertext. */
  encrypt: (plain: string) => string;
  /** base64 ciphertext → plaintext. */
  decrypt: (b64: string) => string;
}

interface OnDisk {
  baseURL?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readOnDisk(filePath: string): Promise<OnDisk | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as OnDisk;
  } catch {
    return undefined;
  }
}

export async function saveImageConfig(filePath: string, crypto: ConfigCrypto, cfg: StoredImageConfig): Promise<void> {
  if (!crypto.available()) throw new Error('secure storage is not available on this system');
  const onDisk: OnDisk = {
    baseURL: cfg.baseURL.trim(),
    model: cfg.model.trim(),
    apiKeyEnc: crypto.encrypt(cfg.apiKey),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(onDisk), 'utf8');
}

export async function loadImageConfig(filePath: string, crypto: ConfigCrypto): Promise<StoredImageConfig | undefined> {
  const onDisk = await readOnDisk(filePath);
  if (!onDisk?.baseURL || !onDisk.model || !onDisk.apiKeyEnc) return undefined;
  return { baseURL: onDisk.baseURL, model: onDisk.model, apiKey: crypto.decrypt(onDisk.apiKeyEnc) };
}

/** Status without ever decrypting or exposing the key. */
export async function imageConfigStatus(filePath: string): Promise<ImageConfigStatus> {
  const onDisk = await readOnDisk(filePath);
  if (onDisk?.baseURL && onDisk.model && onDisk.apiKeyEnc) {
    return { configured: true, baseURL: onDisk.baseURL, model: onDisk.model };
  }
  return { configured: false };
}
