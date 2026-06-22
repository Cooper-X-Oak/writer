import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveImageConfig, loadImageConfig, imageConfigStatus, type ConfigCrypto } from './image-config.js';

// Reversible fake crypto (base64) standing in for Electron safeStorage.
const fakeCrypto: ConfigCrypto = {
  available: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (b64) => Buffer.from(b64, 'base64').toString('utf8'),
};

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hsw-cfg-'));
  file = join(dir, 'image-config.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('image-config', () => {
  it('round-trips config; the key is encrypted at rest, never stored in clear', async () => {
    await saveImageConfig(file, fakeCrypto, { baseURL: 'https://relay', model: 'dall-e-3', apiKey: 'sk-secret' });

    const onDisk = await readFile(file, 'utf8');
    expect(onDisk).not.toContain('sk-secret'); // plaintext key must NOT be on disk
    expect(onDisk).toContain('apiKeyEnc');

    const loaded = await loadImageConfig(file, fakeCrypto);
    expect(loaded).toEqual({ baseURL: 'https://relay', model: 'dall-e-3', apiKey: 'sk-secret' });
  });

  it('status reports configured + baseURL/model but NEVER the key', async () => {
    await saveImageConfig(file, fakeCrypto, { baseURL: 'https://relay', model: 'm', apiKey: 'sk-x' });
    const status = await imageConfigStatus(file);
    expect(status).toEqual({ configured: true, baseURL: 'https://relay', model: 'm' });
    expect(JSON.stringify(status)).not.toContain('sk-x');
    expect('apiKey' in status).toBe(false);
  });

  it('reports not-configured when no file exists', async () => {
    expect(await imageConfigStatus(join(dir, 'missing.json'))).toEqual({ configured: false });
    expect(await loadImageConfig(join(dir, 'missing.json'), fakeCrypto)).toBeUndefined();
  });

  it('refuses to save when secure storage is unavailable', async () => {
    const noCrypto: ConfigCrypto = { ...fakeCrypto, available: () => false };
    await expect(
      saveImageConfig(file, noCrypto, { baseURL: 'x', model: 'y', apiKey: 'z' }),
    ).rejects.toThrow(/secure storage/);
  });
});
