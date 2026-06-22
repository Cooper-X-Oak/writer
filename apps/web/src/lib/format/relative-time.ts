// Pure, deterministic relative-time formatter (Chinese). `now` is injected so it is testable and
// never flakes on a live clock; null/unparseable timestamps render as an em dash.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatRelative(iso: string | null, now: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = now - t;
  if (diff < 0) return '刚刚';
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${String(Math.floor(diff / MIN))} 分钟前`;
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))} 小时前`;
  if (diff < 30 * DAY) return `${String(Math.floor(diff / DAY))} 天前`;
  return new Date(t).toISOString().slice(0, 10); // older than a month → the date
}
