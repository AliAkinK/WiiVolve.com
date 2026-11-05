import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRss, renderJsonFeed, buildJsonFeed, rfc822 } from '../scripts/lib/feeds-out.mjs';
import { parseFeed } from '../scripts/lib/parse.mjs';

const site = { url: 'https://wiivolve.com', name: 'WiiVolve', description: 'Fresh Nintendo Wii news & scene activity.' };
const sources = [
  { id: 'nintendolife', url: 'https://www.nintendolife.com/feeds/latest' },
  { id: 'googlenews', url: 'https://news.google.com/rss/search?q=%22Nintendo+Wii%22&hl=en-US' },
];
const items = [
  {
    id: 'a3f9c1d2e4b5', title: `Tom & Jerry's <b>"Wii"</b> party`, url: 'https://example.com/a?x=1&y=2', source: 'Nintendo Life',
    sourceId: 'nintendolife', tab: 'press', published: '2026-11-04T16:17:00Z', firstSeen: '2026-11-04T16:20:00Z', excerpt: '5 < 6 & "quotes"', matched: ['Wii'],
  },
  {
    id: 'b4e8d2c1a0f9', title: 'No excerpt here', url: 'https://news.google.com/rss/articles/X?oc=5', source: 'BGR', via: 'Google News',
    sourceId: 'googlenews', tab: 'press', published: '2026-11-03T08:00:00Z', firstSeen: '2026-11-03T08:00:00Z', excerpt: '', matched: ['Wii'],
  },
  {
    id: 'wv-267', title: 'Archive item', url: 'https://web.archive.org/web/2008/http://wiivolve.com/', source: 'WiiVolve', sourceId: 'wiivolve',
    tab: 'archive', published: '2008-03-01T13:12:00Z', firstSeen: '2008-03-01T13:12:00Z', excerpt: 'Old', matched: [],
  },
  {
    id: 'cccccccccccc', title: 'Hostile link', url: 'javascript:alert(1)', source: 'X', sourceId: 'nintendolife', tab: 'press',
    published: '2026-11-02T08:00:00Z', firstSeen: '2026-11-02T08:00:00Z', excerpt: '', matched: [],
  },
];

/** Minimal well-formedness check: balanced tags, no stray "<" or "&" in text, quoted attributes. */
function assertWellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  let roots = 0;
  while ((m = re.exec(body))) {
    if (m[6]) assert.fail(`stray "<" at ${m.index}: ${body.slice(m.index, m.index + 40)}`);
    if (m[5] !== undefined) {
      if (!stack.length) assert.match(m[5], /^\s*$/, 'text outside the root');
      assert.doesNotMatch(m[5], /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/, `bad entity in: ${m[5].slice(0, 60)}`);
      continue;
    }
    const [, close, name, attrs, selfClose] = m;
    assert.doesNotMatch(attrs, /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/, `bad entity in attributes of <${name}>`);
    if (close) assert.equal(stack.pop(), name, `mismatched </${name}>`);
    else if (!selfClose) {
      if (!stack.length) roots++;
      stack.push(name);
    } else if (!stack.length) roots++;
  }
  assert.deepEqual(stack, [], 'unclosed elements');
  assert.equal(roots, 1, 'exactly one root element');
}

test('rfc822 formats dates the way RSS expects', () => {
  assert.equal(rfc822('2026-11-04T16:17:00Z'), 'Wed, 04 Nov 2026 16:17:00 GMT');
  assert.equal(rfc822('nope'), '');
});

test('RSS 2.0: channel, self link and one escaped <item> per live item', () => {
  const xml = renderRss({ site, items, sources, generatedAt: '2026-11-04T17:00:00Z' });
  assertWellFormed(xml);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<atom:link href="https:\/\/wiivolve\.com\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(xml, /<link>https:\/\/wiivolve\.com\/<\/link>/);
  assert.match(xml, /<lastBuildDate>Wed, 04 Nov 2026 17:00:00 GMT<\/lastBuildDate>/);
  assert.match(xml, /<description>Fresh Nintendo Wii news &amp; scene activity\.<\/description>/);
  assert.equal((xml.match(/<item>/g) || []).length, 2, 'archive and non-http items are left out');
  assert.match(xml, /<title>Tom &amp; Jerry&#39;s &lt;b&gt;&quot;Wii&quot;&lt;\/b&gt; party<\/title>/);
  assert.match(xml, /<link>https:\/\/example\.com\/a\?x=1&amp;y=2<\/link>/);
  assert.match(xml, /<guid isPermaLink="false">a3f9c1d2e4b5<\/guid>/);
  assert.match(xml, /<pubDate>Wed, 04 Nov 2026 16:17:00 GMT<\/pubDate>/);
  assert.match(xml, /<description>5 &lt; 6 &amp; &quot;quotes&quot;<\/description>/);
  assert.match(xml, /<source url="https:\/\/www\.nintendolife\.com\/feeds\/latest">Nintendo Life<\/source>/);
  assert.match(xml, /<source url="https:\/\/news\.google\.com\/rss\/search\?q=%22Nintendo\+Wii%22&amp;hl=en-US">BGR<\/source>/);
  assert.match(xml, /<category>press<\/category>/);
  const second = xml.slice(xml.lastIndexOf('<item>'));
  assert.doesNotMatch(second, /<description>/, 'no empty description');
  assert.doesNotMatch(xml, /javascript:|Archive item/);
});

test('RSS output round-trips through the parser', () => {
  const feed = parseFeed(renderRss({ site, items, sources, generatedAt: '2026-11-04T17:00:00Z' }));
  assert.equal(feed.format, 'rss');
  assert.equal(feed.title, 'WiiVolve');
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].title, `Tom & Jerry's <b>"Wii"</b> party`);
  assert.equal(feed.items[0].link, 'https://example.com/a?x=1&y=2');
  assert.equal(feed.items[0].guid, 'a3f9c1d2e4b5');
  assert.equal(feed.items[0].sourceName, 'Nintendo Life');
  assert.deepEqual(feed.items[0].categories, ['press']);
});

test('an empty item list is still a valid feed', () => {
  const xml = renderRss({ site, items: [], sources, generatedAt: '2026-11-04T17:00:00Z' });
  assertWellFormed(xml);
  assert.equal(parseFeed(xml).items.length, 0);
});

test('JSON Feed 1.1 shape', () => {
  const feed = buildJsonFeed({ site, items });
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.title, 'WiiVolve');
  assert.equal(feed.home_page_url, 'https://wiivolve.com/');
  assert.equal(feed.feed_url, 'https://wiivolve.com/feed.json');
  assert.equal(feed.description, site.description);
  assert.equal(feed.language, 'en');
  assert.equal(feed.icon, 'https://wiivolve.com/icon-512.png');
  assert.equal(feed.favicon, 'https://wiivolve.com/icon-192.png');
  assert.equal(feed.items.length, 2);
  assert.deepEqual(feed.items[0], {
    id: 'a3f9c1d2e4b5',
    url: 'https://example.com/a?x=1&y=2',
    title: `Tom & Jerry's <b>"Wii"</b> party`,
    content_text: '5 < 6 & "quotes"',
    date_published: '2026-11-04T16:17:00Z',
    authors: [{ name: 'Nintendo Life' }],
    tags: ['press'],
  });
  assert.equal(feed.items[1].content_text, 'No excerpt here', 'falls back to the title');
  const text = renderJsonFeed({ site, items });
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(JSON.parse(text), feed);
});

test('feeds are deterministic', () => {
  const a = renderRss({ site, items, sources, generatedAt: '2026-11-04T17:00:00Z' });
  const b = renderRss({ site, items: structuredClone(items), sources, generatedAt: '2026-11-04T17:00:00Z' });
  assert.equal(a, b);
  assert.equal(renderJsonFeed({ site, items }), renderJsonFeed({ site, items: structuredClone(items) }));
});
