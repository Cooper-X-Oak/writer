import type { SourceType } from '@app/contracts';

/** Short human label for a hotspot source type. */
export function sourceLabel(sourceType: SourceType): string {
  return sourceType === 'hn' ? 'HN' : 'RSS';
}

/** Hostname of a URL for compact display; falls back to the raw string if it does not parse. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
