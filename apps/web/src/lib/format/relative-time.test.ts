import { describe, it, expect } from 'vitest';
import { formatRelative } from './relative-time';

const NOW = Date.parse('2026-06-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelative', () => {
  it('renders — for null/unparseable', () => {
    expect(formatRelative(null, NOW)).toBe('—');
    expect(formatRelative('not-a-date', NOW)).toBe('—');
  });
  it('renders 刚刚 for <1min and future timestamps', () => {
    expect(formatRelative(ago(30_000), NOW)).toBe('刚刚');
    expect(formatRelative(new Date(NOW + 60_000).toISOString(), NOW)).toBe('刚刚');
  });
  it('renders minutes / hours / days', () => {
    expect(formatRelative(ago(5 * 60_000), NOW)).toBe('5 分钟前');
    expect(formatRelative(ago(3 * 3_600_000), NOW)).toBe('3 小时前');
    expect(formatRelative(ago(2 * 86_400_000), NOW)).toBe('2 天前');
  });
  it('renders an ISO date when older than a month', () => {
    expect(formatRelative('2026-01-01T00:00:00.000Z', NOW)).toBe('2026-01-01');
  });
});
