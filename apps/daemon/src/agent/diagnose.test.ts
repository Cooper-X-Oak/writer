import { describe, it, expect } from 'vitest';
import { buildDiagnosis } from './diagnose.js';
import { claudeCode } from '@app/agent-defs';

describe('buildDiagnosis', () => {
  it('READY → ready, no fix, version in title', () => {
    const d = buildDiagnosis(claudeCode, { state: 'READY', version: '2.1.185' });
    expect(d).toMatchObject({ agentId: 'claude', agentName: 'Claude Code', ready: true, state: 'READY' });
    expect(d.title).toContain('2.1.185');
    expect(d.fix).toBeUndefined();
  });

  it('NOT_INSTALLED → install fix with the def install link', () => {
    const d = buildDiagnosis(claudeCode, { state: 'NOT_INSTALLED' });
    expect(d.ready).toBe(false);
    expect(d.fix?.href).toBe(claudeCode.installUrl);
    expect(d.fix?.label).toMatch(/install/i);
  });

  it('VERSION_PROBE_FAILED → reinstall', () => {
    const d = buildDiagnosis(claudeCode, { state: 'VERSION_PROBE_FAILED', detail: 'segfault' });
    expect(d.title).toMatch(/failed to run/i);
    expect(d.detail).toBe('segfault');
    expect(d.fix?.label).toMatch(/reinstall/i);
  });

  it('TOO_OLD → update, mentions the minimum version', () => {
    const d = buildDiagnosis(claudeCode, { state: 'TOO_OLD', version: '1.9.0' });
    expect(d.title).toContain('2.0.0');
    expect(d.fix?.label).toMatch(/update/i);
  });

  it('NOT_LOGGED_IN → login command', () => {
    const d = buildDiagnosis(claudeCode, { state: 'NOT_LOGGED_IN' });
    expect(d.fix?.command).toBe('claude login');
  });
});
