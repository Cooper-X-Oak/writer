import { describe, it, expect } from 'vitest';
import { generateImage, type ImageGenConfig } from './image-gen.js';

const CFG: ImageGenConfig = { baseURL: 'https://relay.example/', apiKey: 'sk-test', model: 'dall-e-3' };

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('generateImage', () => {
  it('decodes a b64_json response and posts to {baseURL}/v1/images/generations with Bearer auth', async () => {
    let calledUrl = '';
    let auth = '';
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calledUrl = url;
      auth = String((init?.headers as Record<string, string>).Authorization);
      return Promise.resolve(jsonRes({ data: [{ b64_json: Buffer.from('IMG').toString('base64') }] }));
    }) as unknown as typeof fetch;

    const img = await generateImage(CFG, '一只猫', { fetchImpl });
    expect(calledUrl).toBe('https://relay.example/v1/images/generations'); // trailing slash normalized
    expect(auth).toBe('Bearer sk-test');
    expect(img.contentType).toBe('image/png');
    expect(img.bytes.toString()).toBe('IMG');
  });

  it('fetches the hosted image when the response returns a url', async () => {
    const fetchImpl = ((url: string) => {
      if (url.endsWith('/v1/images/generations')) {
        return Promise.resolve(jsonRes({ data: [{ url: 'https://cdn.example/x.jpg' }] }));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: () => Promise.resolve(new Uint8Array([9, 8, 7]).buffer),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const img = await generateImage(CFG, 'x', { fetchImpl });
    expect(img.contentType).toBe('image/jpeg');
    expect([...img.bytes]).toEqual([9, 8, 7]);
  });

  it('throws with the status on an API error', async () => {
    const fetchImpl = (() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('bad key') } as unknown as Response)) as unknown as typeof fetch;
    await expect(generateImage(CFG, 'x', { fetchImpl })).rejects.toThrow(/image API 401/);
  });

  it('throws when the response has neither url nor b64_json', async () => {
    const fetchImpl = (() => Promise.resolve(jsonRes({ data: [{}] }))) as unknown as typeof fetch;
    await expect(generateImage(CFG, 'x', { fetchImpl })).rejects.toThrow(/neither url nor b64_json/);
  });
});
