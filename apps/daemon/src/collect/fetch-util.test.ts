import { describe, it, expect, vi } from 'vitest';
import {
  isBlockedHost,
  isFetchableUrl,
  safeFetch,
  fetchJsonWithRetry,
  fetchTextWithRetry,
  mapPool,
} from './fetch-util.js';
import type { AdapterDeps, FetchResponse } from './types.js';

interface RespInit {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
}
function resp(init: RespInit = {}): FetchResponse {
  const status = init.status ?? 200;
  const h = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    header: (n) => h.get(n.toLowerCase()) ?? null,
    text: () => Promise.resolve(init.body ?? ''),
    json: () => Promise.resolve(init.json ?? JSON.parse(init.body ?? 'null')),
  };
}

/** Fake FetchLike from a url→response (or url→fn) script. */
function fakeFetch(script: Record<string, FetchResponse | (() => FetchResponse)>): AdapterDeps['fetchImpl'] {
  return (url) => {
    const entry = script[url];
    if (!entry) return Promise.resolve(resp({ status: 404 }));
    return Promise.resolve(typeof entry === 'function' ? entry() : entry);
  };
}

const baseDeps = (fetchImpl: AdapterDeps['fetchImpl']): AdapterDeps => ({
  fetchImpl,
  now: () => 0,
  sleep: () => Promise.resolve(),
});

describe('isBlockedHost', () => {
  it('blocks loopback, private, and link-local literal IPs + localhost', () => {
    for (const h of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '172.31.0.1', '169.254.169.254', '0.0.0.0', '::1', 'localhost', 'api.localhost', 'fc00::1', 'fe80::1']) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });
  it('blocks the IPv6 unspecified/loopback and embedded-IPv4 forms (the dual-stack bypass)', () => {
    for (const h of [
      '::', // unspecified
      '::ffff:127.0.0.1', '[::ffff:127.0.0.1]', '::ffff:7f00:1', // v4-mapped loopback (dotted & hex)
      '::127.0.0.1', // v4-compatible loopback (h5===0)
      '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', // mapped cloud-metadata
      '::ffff:10.0.0.1', '::ffff:192.168.1.1', // mapped private
      '2002:7f00:1::', // 6to4 loopback
      '64:ff9b::7f00:1', // NAT64 loopback
    ]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });
  it('allows public IPs, public IPv6 (compressed + full-form), and ordinary domains (incl. fc*/fd*)', () => {
    for (const h of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', 'example.com', 'news.ycombinator.com', '2606:4700::1', '2606:4700:4700:0:0:0:0:1111', 'fcc.gov', 'fc-barcelona.com', 'fdroid.example']) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
  it('blocks trailing-dot FQDN forms of localhost (the absolute-root-dot bypass)', () => {
    for (const h of ['localhost.', 'api.localhost.', 'LOCALHOST.', 'localhost..']) {
      expect(isBlockedHost(h)).toBe(true);
    }
    expect(isBlockedHost('example.com.')).toBe(false); // a real external FQDN with a root dot stays allowed
  });
});

describe('isFetchableUrl', () => {
  it('accepts http/https public URLs', () => {
    expect(isFetchableUrl('https://example.com/feed')).toBe(true);
    expect(isFetchableUrl('http://1.2.3.4/x')).toBe(true);
  });
  it('rejects non-http(s) schemes, blocked hosts, and garbage', () => {
    expect(isFetchableUrl('ftp://example.com')).toBe(false);
    expect(isFetchableUrl('file:///etc/passwd')).toBe(false);
    expect(isFetchableUrl('javascript:alert(1)')).toBe(false);
    expect(isFetchableUrl('http://127.0.0.1:4319/api/health')).toBe(false);
    expect(isFetchableUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isFetchableUrl('http://[::ffff:127.0.0.1]/')).toBe(false); // dual-stack loopback bypass
    expect(isFetchableUrl('http://[::ffff:169.254.169.254]/')).toBe(false); // mapped metadata
    expect(isFetchableUrl('http://localhost./api/health')).toBe(false); // trailing-dot FQDN bypass
    expect(isFetchableUrl('not a url')).toBe(false);
  });
});

describe('safeFetch (SSRF redirect guard + size cap)', () => {
  it('returns the response for a direct 200', async () => {
    const deps = baseDeps(fakeFetch({ 'https://ok.com/feed': resp({ body: 'hi' }) }));
    const r = await safeFetch(deps, 'https://ok.com/feed');
    expect(await r?.text()).toBe('hi');
  });

  it('follows a redirect to an allowed host and re-validates', async () => {
    const deps = baseDeps(
      fakeFetch({
        'https://ok.com/feed': resp({ status: 302, headers: { location: 'https://other.com/real' } }),
        'https://other.com/real': resp({ body: 'final' }),
      }),
    );
    const r = await safeFetch(deps, 'https://ok.com/feed');
    expect(await r?.text()).toBe('final');
  });

  it('refuses a redirect to a blocked (loopback/metadata) host → null', async () => {
    const deps = baseDeps(
      fakeFetch({ 'https://ok.com/feed': resp({ status: 302, headers: { location: 'http://169.254.169.254/' } }) }),
    );
    expect(await safeFetch(deps, 'https://ok.com/feed')).toBeNull();
  });

  it('caps redirect hops → null after exceeding the limit', async () => {
    const deps = baseDeps(
      fakeFetch({
        'https://a.com/': resp({ status: 302, headers: { location: 'https://b.com/' } }),
        'https://b.com/': resp({ status: 302, headers: { location: 'https://c.com/' } }),
        'https://c.com/': resp({ status: 302, headers: { location: 'https://d.com/' } }),
        'https://d.com/': resp({ status: 302, headers: { location: 'https://e.com/' } }),
      }),
    );
    expect(await safeFetch(deps, 'https://a.com/', { maxRedirects: 2 })).toBeNull();
  });

  it('rejects a response with an HONEST oversized Content-Length header → null', async () => {
    const deps = baseDeps(
      fakeFetch({ 'https://big.com/feed': resp({ headers: { 'content-length': String(10 * 1024 * 1024) } }) }),
    );
    expect(await safeFetch(deps, 'https://big.com/feed', { maxBytes: 5 * 1024 * 1024 })).toBeNull();
  });

  it('does NOT reject when Content-Length is absent — header-only cap here; the streaming running-total guard is added with the real fetch adapter (later PR)', async () => {
    const deps = baseDeps(fakeFetch({ 'https://nolen.com/feed': resp({ body: 'x'.repeat(1000) }) }));
    const r = await safeFetch(deps, 'https://nolen.com/feed', { maxBytes: 10 });
    expect(r).not.toBeNull(); // documents the known limit of the Content-Length-only cap
  });

  it('rejects a non-fetchable seed URL outright', async () => {
    const deps = baseDeps(fakeFetch({}));
    expect(await safeFetch(deps, 'http://127.0.0.1/x')).toBeNull();
  });
});

describe('fetchJsonWithRetry / fetchTextWithRetry', () => {
  it('returns parsed JSON on the first ok response', async () => {
    const deps = baseDeps(fakeFetch({ 'https://api.com/x': resp({ json: { a: 1 } }) }));
    expect(await fetchJsonWithRetry(deps, 'https://api.com/x')).toEqual({ a: 1 });
  });

  it('retries on a 5xx using injected sleep, then succeeds', async () => {
    let calls = 0;
    const deps = baseDeps(
      fakeFetch({
        'https://api.com/x': () => {
          calls += 1;
          return calls === 1 ? resp({ status: 503 }) : resp({ json: { ok: true } });
        },
      }),
    );
    const sleep = vi.fn(() => Promise.resolve());
    expect(await fetchJsonWithRetry({ ...deps, sleep }, 'https://api.com/x')).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('returns null after exhausting retries (never throws)', async () => {
    const deps = baseDeps(fakeFetch({ 'https://api.com/x': resp({ status: 500 }) }));
    expect(await fetchJsonWithRetry(deps, 'https://api.com/x', { retries: 1 })).toBeNull();
  });

  it('returns null on a network error / abort (never throws)', async () => {
    const deps = baseDeps(() => Promise.reject(new Error('aborted')));
    expect(await fetchTextWithRetry(deps, 'https://api.com/x', { retries: 1 })).toBeNull();
  });

  it('fetchTextWithRetry returns the body', async () => {
    const deps = baseDeps(fakeFetch({ 'https://api.com/x': resp({ body: '<rss/>' }) }));
    expect(await fetchTextWithRetry(deps, 'https://api.com/x')).toBe('<rss/>');
  });
});

describe('mapPool', () => {
  it('runs at most `limit` tasks in flight and preserves input order', async () => {
    const items = [0, 1, 2, 3, 4, 5];
    const defs = items.map(() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const pool = mapPool(items, 2, async (item, i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await defs[i]!.promise;
      inFlight -= 1;
      return item * 10;
    });
    defs.forEach((d) => d.resolve());
    const results = await pool;
    expect(results).toEqual([0, 10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('a task returning null does not break the pool (callers filter)', async () => {
    const out = await mapPool([1, 2, 3], 2, (n) => Promise.resolve(n === 2 ? null : n));
    expect(out).toEqual([1, null, 3]);
  });
});
