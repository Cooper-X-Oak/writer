// Hardened fetch helpers for the collect layer. The daemon fetches USER-SUPPLIED feed URLs, so the
// real risk is SSRF — and the URL ultimately fetched is NOT the validated seed URL once redirects
// follow. Defenses (proportionate for a loopback single-user app, NOT enterprise DNS-pinning):
//   • redirect:'manual' + a small hop cap; re-validate scheme + literal-IP on EVERY hop.
//   • scheme allowlist http/https; block loopback/private/link-local literal IPs (incl. metadata IP),
//     classified by NUMERIC range — covering IPv4, IPv6, and embedded-IPv4 IPv6 forms (::ffff:V4,
//     v4-compat, 6to4, NAT64) so the dual-stack bypass to loopback/metadata is closed.
//   • Content-Length header size cap. NOTE: the absent/lying-header case (a body that streams past
//     the cap with no/false Content-Length) is NOT bounded at this layer — the streaming
//     running-total guard is added with the real Response→FetchResponse adapter in a later PR.
//   • Everything runs over the injected FetchLike, so the guard is unit-tested fully offline.

import { isIP } from 'node:net';
import type { AdapterDeps, FetchResponse } from './types.js';

export const MAX_REDIRECTS = 3;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Block loopback / "this host" / private / link-local IPv4 by octet, by numeric range. */
function isBlockedIPv4Octets(a: number, b: number): boolean {
  if (a === 127 || a === 0 || a === 10) return true; // loopback / this-host / private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 (cloud metadata)
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  return false;
}

function isBlockedIPv4(host: string): boolean {
  const octets = host.split('.');
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) return false;
  const a = Number(octets[0]);
  const b = Number(octets[1]);
  if (a > 255 || b > 255) return false;
  return isBlockedIPv4Octets(a, b);
}

/** Expand an IPv6 literal (already validated by node:net) to its 8 numeric hextets, or null. Any
 *  trailing dotted-IPv4 tail (::ffff:127.0.0.1) is folded into two hextets first. */
function expandIPv6(host: string): number[] | null {
  let s = host;
  const dotted = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted?.[1]) {
    const v4 = dotted[1].split('.').map(Number);
    const hi = ((v4[0] ?? 0) << 8) | (v4[1] ?? 0);
    const lo = ((v4[2] ?? 0) << 8) | (v4[3] ?? 0);
    s = `${s.slice(0, dotted.index + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - headParts.length - tailParts.length : 0;
  if (fill < 0) return null;
  const groups = [...headParts, ...Array<string>(fill).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || '0', 16));
}

function isBlockedIPv6(host: string): boolean {
  const h = expandIPv6(host);
  if (!h) return false;
  const [h0, h1, , , , h5, h6, h7] = h as [number, number, number, number, number, number, number, number];
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h7 === 1) return true; // ::1
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // embedded IPv4: ::ffff:V4 (mapped) / ::V4 (compat) / 6to4 (2002::) / NAT64 (64:ff9b::)
  const embedded =
    h.slice(0, 5).every((x) => x === 0) && (h5 === 0xffff || h5 === 0)
      ? ([h6, h7] as const)
      : h0 === 0x2002
        ? ([h1, h[2] ?? 0] as const)
        : h0 === 0x0064 && h1 === 0xff9b
          ? ([h6, h7] as const)
          : null;
  if (embedded) return isBlockedIPv4Octets(embedded[0] >> 8, embedded[0] & 0xff);
  return false;
}

/** Reject literal loopback / private / link-local IP destinations (and localhost) on every hop.
 *  Classifies by node:net IP kind + numeric range, so non-dotted-decimal and embedded-IPv4 IPv6
 *  encodings cannot slip past as "not an IP". A plain DNS name (isIP === 0) is allowed. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = isIP(host);
  if (kind === 6) return isBlockedIPv6(host);
  if (kind === 4) return isBlockedIPv4(host);
  return false; // a real hostname (DNS name) — not an IP literal
}

/** A URL is fetchable iff it parses, uses http/https, and does not target a blocked host. */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !isBlockedHost(u.hostname);
}

/** Resolve a (possibly relative) Location against the current URL, returning null if unfetchable. */
function nextHop(current: string, location: string): string | null {
  let resolved: string;
  try {
    resolved = new URL(location, current).toString();
  } catch {
    return null;
  }
  return isFetchableUrl(resolved) ? resolved : null;
}

function exceedsSizeCap(res: FetchResponse, maxBytes: number): boolean {
  const len = res.header('content-length');
  if (!len) return false; // absent/lying header → the streaming cap (production adapter) is the backstop
  const n = Number(len);
  return Number.isFinite(n) && n > maxBytes;
}

export interface SafeFetchOpts {
  maxRedirects?: number;
  maxBytes?: number;
}

/** One guarded request: validates the URL, follows redirects MANUALLY with per-hop re-validation,
 *  enforces the size cap. Returns the final response, or null if blocked/over-size/too many hops. */
export async function safeFetch(
  deps: AdapterDeps,
  url: string,
  opts: SafeFetchOpts = {},
): Promise<FetchResponse | null> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isFetchableUrl(current)) return null;
    const res = await deps.fetchImpl(current, { signal: deps.signal, redirect: 'manual' });
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.header('location');
      const next = location ? nextHop(current, location) : null;
      if (!next) return null;
      current = next;
      continue;
    }
    if (exceedsSizeCap(res, maxBytes)) return null;
    return res;
  }
  return null; // too many redirects
}

export interface RetryOpts extends SafeFetchOpts {
  retries?: number;
  baseDelayMs?: number;
}

async function withRetry(
  deps: AdapterDeps,
  url: string,
  opts: RetryOpts,
): Promise<FetchResponse | null> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.baseDelayMs ?? 200;
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res: FetchResponse | null;
    try {
      res = await safeFetch(deps, url, opts);
    } catch {
      res = null; // network error → retry/give up, never throw out of the collect layer
    }
    if (res && res.ok) return res;
    const retryable = !res || RETRYABLE_STATUSES.has(res.status);
    if (!retryable || attempt === retries) return res && res.ok ? res : null;
    await sleep(baseDelay * 2 ** attempt); // exponential backoff
  }
  return null;
}

/** Fetch JSON; returns the parsed value, or null on any failure (never throws). */
export async function fetchJsonWithRetry(
  deps: AdapterDeps,
  url: string,
  opts: RetryOpts = {},
): Promise<unknown | null> {
  const res = await withRetry(deps, url, opts);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch text; returns the body string, or null on any failure (never throws). */
export async function fetchTextWithRetry(
  deps: AdapterDeps,
  url: string,
  opts: RetryOpts = {},
): Promise<string | null> {
  const res = await withRetry(deps, url, opts);
  if (!res) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/** Bounded-concurrency map preserving input order. One failing task does not reject the pool when
 *  `fn` is written to resolve (return null) on its own errors — callers filter nulls. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i] as T;
      results[i] = await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
