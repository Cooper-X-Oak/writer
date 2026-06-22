import { describe, it, expect, afterEach } from 'vitest';
import { getBridge, type HswBridge } from './electron';

type G = { window?: { hsw?: HswBridge } };

afterEach(() => {
  const g = globalThis as unknown as G;
  if (g.window) delete g.window.hsw;
});

describe('getBridge', () => {
  it('returns null when there is no window or no bridge', () => {
    expect(getBridge()).toBeNull();
  });

  it('returns the bridge when window.hsw is present', () => {
    const fake = {
      saveImageConfig: () => Promise.resolve(),
      imageConfigStatus: () => Promise.resolve({ configured: false }),
      generateImage: () => Promise.resolve({ html: '', name: '' }),
      exportPdf: () => Promise.resolve({ saved: false }),
    } as HswBridge;
    const g = globalThis as unknown as G;
    g.window = { ...(g.window ?? {}), hsw: fake };
    expect(getBridge()).toBe(fake);
  });
});
