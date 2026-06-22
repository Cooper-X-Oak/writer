import { describe, it, expect, afterEach } from 'vitest';
import { parseFeed, detectFormat, parseFeedDate, resolveLink, createRssAdapter, FEED_PARSER_OPTIONS } from './rss.js';
import { XMLParser } from 'fast-xml-parser';
import type { AdapterDeps, FetchResponse } from '../types.js';

const FETCHED = '2026-06-22T00:00:00.000Z';
const FEED_URL = 'https://example.com/feed.xml';

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example</title><link>https://example.com/</link><description>Test</description>
  <item>
    <title><![CDATA[New <b>WebGPU</b> ships]]></title>
    <link>https://example.com/posts/webgpu</link>
    <description><![CDATA[<p>Browsers expose <b>compute shaders</b> &amp; more.</p>]]></description>
    <pubDate>Mon, 22 Jun 2026 07:30:00 GMT</pubDate>
    <author>editor@example.com</author>
    <guid isPermaLink="false">urn:example:webgpu-001</guid>
  </item>
  <item>
    <title>Relative link, no date</title>
    <link>/posts/no-date</link>
    <description>Plain text.</description>
    <guid isPermaLink="true">https://example.com/posts/no-date</guid>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.org/">
  <title>Example Atom</title>
  <link href="https://example.org/" rel="alternate"/>
  <updated>2026-06-22T07:30:00Z</updated>
  <entry>
    <title type="html">New &lt;b&gt;Rust&lt;/b&gt; release</title>
    <link href="posts/rust-release" rel="alternate"/>
    <link href="posts/rust-release.atom" rel="self"/>
    <id>urn:example:rust-001</id>
    <updated>2026-06-22T09:15:00+08:00</updated>
    <summary type="html">&lt;p&gt;Async closures stabilized.&lt;/p&gt;</summary>
    <author><name>Jane Maintainer</name></author>
  </entry>
</feed>`;

describe('detectFormat', () => {
  const parse = (xml: string) => new XMLParser(FEED_PARSER_OPTIONS).parse(xml);
  it('classifies rss2 / atom / rss1-rdf / unknown', () => {
    expect(detectFormat(parse(RSS2))).toBe('rss2');
    expect(detectFormat(parse(ATOM))).toBe('atom');
    expect(detectFormat(parse('<rdf:RDF xmlns="http://purl.org/rss/1.0/"><item/></rdf:RDF>'))).toBe('rss1-rdf');
    expect(detectFormat(parse('<html><body/></html>'))).toBe('unknown');
  });
});

describe('parseFeedDate', () => {
  it('RFC-822 GMT → UTC ISO', () => {
    expect(parseFeedDate('Mon, 22 Jun 2026 07:30:00 GMT')).toBe('2026-06-22T07:30:00.000Z');
  });
  it('RFC-822 obsolete alpha zone (EST) is mapped via the offset table', () => {
    expect(parseFeedDate('Mon, 22 Jun 2026 07:30:00 EST')).toBe('2026-06-22T12:30:00.000Z');
  });
  it('RFC-822 numeric offset', () => {
    expect(parseFeedDate('Mon, 22 Jun 2026 07:30:00 +0800')).toBe('2026-06-21T23:30:00.000Z');
  });
  it('ISO-8601 with offset → UTC', () => {
    expect(parseFeedDate('2026-06-22T09:15:00+08:00')).toBe('2026-06-22T01:15:00.000Z');
  });
  it('ambiguous / missing / garbage → null (never assume local time)', () => {
    expect(parseFeedDate('Mon, 22 Jun 2026 07:30:00')).toBeNull(); // no zone
    expect(parseFeedDate('2026-06-22T07:30:00')).toBeNull(); // ISO without zone
    expect(parseFeedDate('not a date')).toBeNull();
    expect(parseFeedDate(undefined)).toBeNull();
    expect(parseFeedDate('')).toBeNull();
  });
  it('is timezone-independent (same output under different process.env.TZ)', () => {
    const prev = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const a = parseFeedDate('Mon, 22 Jun 2026 07:30:00 GMT');
      process.env.TZ = 'Asia/Shanghai';
      const b = parseFeedDate('Mon, 22 Jun 2026 07:30:00 GMT');
      expect(a).toBe(b);
      expect(a).toBe('2026-06-22T07:30:00.000Z');
    } finally {
      process.env.TZ = prev;
    }
  });
});

describe('resolveLink', () => {
  it('resolves relative against base and rejects non-http(s)/garbage', () => {
    expect(resolveLink('/posts/x', 'https://e.com/feed')).toBe('https://e.com/posts/x');
    expect(resolveLink('https://e.com/y', 'https://e.com/')).toBe('https://e.com/y');
    expect(resolveLink('ftp://e.com/z', 'https://e.com/')).toBeNull();
    expect(resolveLink('', 'https://e.com/')).toBeNull();
    expect(resolveLink('http://[malformed', 'https://e.com/')).toBeNull(); // URL ctor throws → caught
  });
});

describe('parseFeed (RSS 2.0)', () => {
  it('maps items: CDATA title stripped, description HTML stripped, GMT date, guid key', () => {
    const nodes = parseFeed(RSS2, FEED_URL, FETCHED);
    expect(nodes).toHaveLength(2);
    const first = nodes[0]!;
    expect(first.sourceType).toBe('rss');
    expect(first.title).toBe('New WebGPU ships');
    expect(first.url).toBe('https://example.com/posts/webgpu');
    expect(first.excerpt).toBe('Browsers expose compute shaders & more.');
    expect(first.publishedAt).toBe('2026-06-22T07:30:00.000Z');
    expect(first.key).toBe('urn:example:webgpu-001');
    expect(first.fetchedAt).toBe(FETCHED);
  });
  it('resolves a relative link against the feed URL and yields null publishedAt for a missing date', () => {
    const second = parseFeed(RSS2, FEED_URL, FETCHED)[1]!;
    expect(second.url).toBe('https://example.com/posts/no-date');
    expect(second.publishedAt).toBeNull(); // missing date → null, NOT Date.now()
  });
});

describe('parseFeed (Atom 1.0)', () => {
  it('maps an entry: html title decoded+stripped, rel=alternate link resolved against xml:base, +08:00 → UTC', () => {
    const nodes = parseFeed(ATOM, FEED_URL, FETCHED);
    expect(nodes).toHaveLength(1);
    const e = nodes[0]!;
    expect(e.title).toBe('New Rust release');
    expect(e.url).toBe('https://example.org/posts/rust-release'); // rel=alternate, resolved vs xml:base
    expect(e.excerpt).toBe('Async closures stabilized.');
    expect(e.publishedAt).toBe('2026-06-22T01:15:00.000Z');
    expect(e.author).toBe('Jane Maintainer');
    expect(e.key).toBe('urn:example:rust-001');
  });
});

describe('parseFeed resilience', () => {
  it('coalesces a single-item feed into a 1-element array (not dropped)', () => {
    const single = `<rss version="2.0"><channel><title>S</title><item><title>Only</title><link>https://e.com/1</link><guid>g1</guid></item></channel></rss>`;
    expect(parseFeed(single, FEED_URL, FETCHED)).toHaveLength(1);
  });
  it('returns [] for rss1-rdf, unknown, malformed XML, and empty channels (never throws)', () => {
    expect(parseFeed('<rdf:RDF><item/></rdf:RDF>', FEED_URL, FETCHED)).toEqual([]);
    expect(parseFeed('<html/>', FEED_URL, FETCHED)).toEqual([]);
    expect(parseFeed('<rss><channel', FEED_URL, FETCHED)).toEqual([]); // malformed
    expect(parseFeed('<rss version="2.0"><channel><title>empty</title></channel></rss>', FEED_URL, FETCHED)).toEqual([]);
  });
});

describe('parseFeed url/key fallbacks and dropped items', () => {
  it('RSS: unresolvable link but URL guid → url = guid', () => {
    const xml = `<rss version="2.0"><channel><item><title>T</title><link>javascript:alert(1)</link><guid>https://e.com/g</guid></item></channel></rss>`;
    expect(parseFeed(xml, FEED_URL, FETCHED)[0]!.url).toBe('https://e.com/g');
  });
  it('RSS: unresolvable link and non-URL guid → url falls back to the feed URL', () => {
    const xml = `<rss version="2.0"><channel><item><title>T</title><link>javascript:x</link><guid>plain-guid-123</guid></item></channel></rss>`;
    const n = parseFeed(xml, FEED_URL, FETCHED)[0]!;
    expect(n.url).toBe(FEED_URL);
    expect(n.key).toBe('plain-guid-123');
  });
  it('RSS: maps dc:creator as the author', () => {
    const xml = `<rss version="2.0"><channel><item><title>T</title><link>https://e.com/a</link><guid>g</guid><dc:creator>Jane Q</dc:creator></item></channel></rss>`;
    expect(parseFeed(xml, FEED_URL, FETCHED)[0]!.author).toBe('Jane Q');
  });
  it('RSS: an item with no title/link/guid is dropped', () => {
    const xml = `<rss version="2.0"><channel><item><description>orphan</description></item></channel></rss>`;
    expect(parseFeed(xml, FEED_URL, FETCHED)).toEqual([]);
  });
  it('RSS: an element with only attributes (no text/cdata) yields empty text → "(untitled)"', () => {
    const xml = `<rss version="2.0"><channel><item><title region="x"></title><link>https://e.com/z</link><guid>gz</guid></item></channel></rss>`;
    expect(parseFeed(xml, FEED_URL, FETCHED)[0]!.title).toBe('(untitled)');
  });
  it('RSS: a title-only item is kept with a stable hashed key (guid+link both absent)', () => {
    const xml = `<rss version="2.0"><channel><item><title>OnlyTitle</title></item></channel></rss>`;
    const n = parseFeed(xml, FEED_URL, FETCHED)[0]!;
    expect(n.title).toBe('OnlyTitle');
    expect(n.url).toBe(FEED_URL); // no link/guid → feed URL
    expect(n.key).toMatch(/^[0-9a-f]{16}$/); // stableKey hash
  });
  it('RSS: rss element without a channel → []', () => {
    expect(parseFeed('<rss version="2.0"></rss>', FEED_URL, FETCHED)).toEqual([]);
  });
  it('Atom: string <link>, link without rel, and id-as-url fallback', () => {
    const stringLink = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link>https://e.org/a</link><id>i1</id></entry></feed>`;
    expect(parseFeed(stringLink, FEED_URL, FETCHED)[0]!.url).toBe('https://e.org/a');

    const noRel = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>B</title><link href="https://e.org/b"/><id>i2</id></entry></feed>`;
    expect(parseFeed(noRel, FEED_URL, FETCHED)[0]!.url).toBe('https://e.org/b');

    const idUrl = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>C</title><id>https://e.org/c</id></entry></feed>`;
    expect(parseFeed(idUrl, FEED_URL, FETCHED)[0]!.url).toBe('https://e.org/c');
  });
  it('Atom: only a self link (no alternate) is used as the fallback url', () => {
    const selfOnly = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>D</title><link href="https://e.org/d" rel="self"/><id>i4</id></entry></feed>`;
    expect(parseFeed(selfOnly, FEED_URL, FETCHED)[0]!.url).toBe('https://e.org/d');
  });
  it('Atom: content used when summary is absent', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>E</title><link href="https://e.org/e" rel="alternate"/><id>i5</id><content>&lt;p&gt;Body here.&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeed(xml, FEED_URL, FETCHED)[0]!.excerpt).toBe('Body here.');
  });
});

describe('createRssAdapter', () => {
  function resp(body: string | null, status = 200): FetchResponse {
    return {
      ok: status >= 200 && status < 300,
      status,
      header: () => null,
      text: () => Promise.resolve(body ?? ''),
      json: () => Promise.resolve(null),
    };
  }
  const GOOD = 'https://good.com/feed';
  const DEAD = 'https://dead.com/feed';

  it('fetches each feed, parses the good one, and a dead feed contributes [] without throwing', async () => {
    const deps: AdapterDeps = {
      now: () => Date.parse(FETCHED),
      sleep: () => Promise.resolve(),
      fetchImpl: (url) => Promise.resolve(url === GOOD ? resp(RSS2) : resp(null, 500)),
    };
    const nodes = await createRssAdapter([GOOD, DEAD]).collect(deps);
    expect(nodes).toHaveLength(2); // both items from the GOOD feed; DEAD contributed nothing
    expect(nodes.every((n) => n.sourceType === 'rss')).toBe(true);
  });

  it('returns [] when there are no feed URLs', async () => {
    const deps: AdapterDeps = { now: () => 0, fetchImpl: () => Promise.reject(new Error('unused')) };
    expect(await createRssAdapter([]).collect(deps)).toEqual([]);
  });
});

afterEach(() => {
  /* no global state */
});
