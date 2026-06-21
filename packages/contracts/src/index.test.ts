import { describe, it, expect } from 'vitest';
import { CONTRACTS_PACKAGE } from './index.js';
import type { Health } from './index.js';

describe('@app/contracts', () => {
  it('exposes the package id', () => {
    expect(CONTRACTS_PACKAGE).toBe('@app/contracts');
  });

  it('Health DTO has the expected shape', () => {
    const h: Health = { status: 'ok', version: '0.0.0', uptimeMs: 0 };
    expect(h.status).toBe('ok');
    expect(typeof h.version).toBe('string');
    expect(typeof h.uptimeMs).toBe('number');
  });
});
