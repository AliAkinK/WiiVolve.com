import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeEntities, collapseWhitespace, stripTags, truncate, cleanTitle, cleanExcerpt, canonicalUrl, isHttpUrl,
  parseDate, prettifyPublisher, splitPublisherSuffix, titleKey, foldText, normalizeEntry, EXCERPT_MAX, TITLE_MAX,
} from '../scripts/lib/text.mjs';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { decodeBody } from '../scripts/lib/fetch.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
// A frozen copy of the launch feeds.json: the tests own their inputs, so editing the real config never breaks them.
const feeds = JSON.parse(await readFile(path.join(FIX, 'feeds.json'), 'utf8'));
const source = (id) => feeds.sources.find((s) => s.id === id);
const fixture = async (name) => parseFeed(decodeBody(await readFile(path.join(FIX, name))).text);
const NBSP = String.fromCharCode(0xa0);
const ZWSP = String.fromCharCode(0x200b);

test('decodeEntities handles named, numeric and odd references', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot; &apos;yo&apos;'), `Tom & Jerry <3 "hi" 'yo'`);
  assert.equal(decodeEntities('&eacute;&mdash;&rsquo;&hellip;&nbsp;&copy;&trade;'), `é—’…${NBSP}©™`);
  assert.equal(decodeEntities('&#8217;&#x2019;&#X2019;'), '’’’');
  assert.equal(decodeEntities('&#150; &#151; &#128;'), '– — €', 'C1 range maps like windows-1252');
  assert.equal(decodeEntities('&#0;&#xD800;&#x110000;'), String.fromCharCode(0xfffd).repeat(3));
  assert.equal(decodeEntities('&bogus; & AT&T &amp'), '&bogus; & AT&T &amp', 'unknown or unterminated entities stay');
  assert.equal(decodeEntities('&#128512;'), '😀');
  assert.equal(decodeEntities(null), '');
});

test('collapseWhitespace folds NBSP and drops zero-width characters', () => {
  assert.equal(collapseWhitespace(`  a${NBSP}${NBSP}b\n\t c${ZWSP}d  `), 'a b cd');
});

test('stripTags turns HTML into readable plain text', () => {
  assert.equal(stripTags('<p>One</p><p>Two<br>Three</p>'), 'One Two Three');
  assert.equal(stripTags('<b>bo</b>ld <a href="x" title="a > b">link</a>'), 'bold link');
  assert.equal(stripTags('<!-- c --><script>alert(1)</script><style>p{}</style>Text'), 'Text');
  assert.equal(stripTags('<header><img src="x" alt="y"><p>Image credit</p></header><p>Body</p>'), 'Body');
  assert.equal(stripTags('<figure><img src=x><figcaption>Caption</figcaption></figure>After'), 'After');
  assert.equal(stripTags('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>', 'escaped text stays text');
  assert.equal(stripTags('5 < 6 and 7 > 3'), '5 < 6 and 7 > 3');
});

test('truncate cuts on a word boundary with an ellipsis and never exceeds the limit', () => {
  const long = 'word '.repeat(100);
  const t = truncate(long, 50);
  assert.ok(t.length <= 50);
  assert.ok(t.endsWith('…'));
  assert.ok(!t.endsWith(' …'));
  assert.equal(truncate('short', 50), 'short');
  assert.equal(truncate('a'.repeat(300), 220).length, 220);
  const emoji = `${'x'.repeat(218)}😀😀😀`;
  const e = truncate(emoji, 220);
  assert.ok(e.length <= 220);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(e), 'no dangling high surrogate');
  assert.equal(truncate('Ends with comma, and more words here', 20), 'Ends with comma…');
});

test('cleanTitle strips inline tags, decodes twice-encoded entities and caps at 200', () => {
  assert.equal(cleanTitle('<b>Wii</b> &amp; <em>you</em>'), 'Wii & you');
  assert.equal(cleanTitle('Is this <insert game> worth it?'), 'Is this <insert game> worth it?');
  assert.equal(cleanTitle('  spaced \n  out  '), 'spaced out');
  assert.equal(cleanTitle('<![CDATA[Leftover]]>'), 'Leftover');
  const t = cleanTitle('Wii '.repeat(80));
  assert.ok(t.length <= TITLE_MAX);
  assert.ok(t.endsWith('…'));
});

test('cleanExcerpt removes common boilerplate', () => {
  assert.equal(
    cleanExcerpt('<p><strong>Tagline.</strong></p><p>Body text.</p><p>Read the <a href="x">full article on nintendolife.com</a></p>'),
    'Tagline. Body text.',
  );
  assert.equal(
    cleanExcerpt('<p>Story here...</p>\n<p>The post <a href="x">A Title</a> appeared first on <a href="y">Nintendo Everything</a>.</p>'),
    'Story here…',
  );
  assert.equal(
    cleanExcerpt('<div><img src="x"></div>Proves that it isn&#8217;t restricted to the x86 era, <a href="x" class="read-more">&#8230;read more</a>'),
    'Proves that it isn’t restricted to the x86 era…',
  );
  assert.equal(cleanExcerpt('<p>A story.</p><p>Continue reading “A story” →</p>'), 'A story.');
  assert.equal(cleanExcerpt('<p>Short teaser [&hellip;]</p>'), 'Short teaser…');
  assert.equal(
    cleanExcerpt('<!-- SC_OFF --><div class="md"><p>My post body</p></div><!-- SC_ON --> &#32; submitted by &#32; <a href="u"> /u/Some-User_1 </a> <br/> <span><a href="l">[link]</a></span> &#32; <span><a href="c">[comments]</a></span>'),
    'My post body',
  );
  assert.equal(cleanExcerpt('&#32; submitted by &#32; <a href="u"> /u/x </a> <span><a href="l">[link]</a></span> <span><a href="c">[comments]</a></span>'), '');
  assert.equal(cleanExcerpt('<a href="x">Same as the title</a>&nbsp;&nbsp;<font color="#6f6f6f">BGR</font>', { title: 'Same as the title' }), '');
  assert.equal(cleanExcerpt('<p>Keep me. Drop this tail</p>', { strip: ['Drop this tail'] }), 'Keep me.');
  assert.equal(cleanExcerpt('<p>Keep me.</p>', { strip: ['(unclosed'] }), 'Keep me.', 'invalid strip patterns are ignored');
  const long = cleanExcerpt(`<p>${'Lots of words here. '.repeat(40)}</p>`);
  assert.ok(long.length <= EXCERPT_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(cleanExcerpt(''), '');
});

test('excerpts join paragraphs with " — " where a sentence would run on, with a space after its punctuation (D10)', () => {
  const ex = (html) => cleanExcerpt(html);
  // The Reddit post that read "make this game No, I have no clue".
  assert.equal(
    ex('<!-- SC_OFF --><div class="md"><p>Yes, AI was used to help make this game</p> <p>No, I have no clue why I made this</p> <p><a href="https://example.com/play/">https://example.com/play/</a></p> </div><!-- SC_ON --> &#32; submitted by &#32; <a href="u"> /u/Some-User </a> <br/> <span><a href="l">[link]</a></span> &#32; <span><a href="c">[comments]</a></span>'),
    'Yes, AI was used to help make this game — No, I have no clue why I made this — https://example.com/play/',
  );
  assert.equal(ex('<p>First sentence.</p><p>Second</p>'), 'First sentence. Second');
  assert.equal(ex('<p>He said “yes!”</p><p>Then left (quietly.)</p><p>End</p>'), 'He said “yes!” Then left (quietly.) End', 'closing quotes and brackets after the punctuation');
  for (const p of [',', ':', ';', '…', '–', '—', '-', '?']) assert.equal(ex(`<p>One${p}</p><p>two</p>`), `One${p} two`, p);
  assert.equal(ex('Line one<br>line two<br/>line three'), 'Line one — line two — line three');
  assert.equal(ex('<ul><li>Wii Sports</li><li>Wii Fit</li></ul>'), 'Wii Sports — Wii Fit');
  assert.equal(ex('<h2>Patch notes</h2><p>Fixed the menu.</p>'), 'Patch notes — Fixed the menu.');
  assert.equal(ex('<p>Signed</p><p>— the team</p>'), 'Signed — the team', 'no double dash');
  assert.equal(ex('Plain text line\nNext line\r\nLast.'), 'Plain text line — Next line — Last.', 'newlines in a field without markup');
  assert.equal(ex('<p>A paragraph wrapped\nin the source</p>'), 'A paragraph wrapped in the source', 'in HTML a newline is only a space');
  assert.equal(ex('<p>One</p>\n\n<p></p><div> </div><p>Two</p>'), 'One — Two', 'empty blocks do not count');
  assert.equal(ex('<p>Read the post</p><p>Read more »</p>'), 'Read the post', 'boilerplate in its own block still goes');
  // Keyword text and titles keep the plain space join.
  assert.equal(stripTags('<p>Wii</p><p>Remote</p>'), 'Wii Remote');
  assert.equal(cleanTitle('Wii<br>Remote'), 'Wii Remote');
  // Linear: 30,000 paragraphs.
  const t0 = performance.now();
  assert.ok(ex('<p>word</p>'.repeat(30000)).length <= 220);
  assert.ok(performance.now() - t0 < 5000);
});

test('canonicalUrl keeps http(s) only and drops tracking parameters', () => {
  assert.equal(canonicalUrl('https://Example.COM/a?utm_source=x&id=1&fbclid=2&gclid=3&mc_cid=4&mc_eid=5&UTM_Medium=6'), 'https://example.com/a?id=1');
  assert.equal(canonicalUrl('https://example.com/a?utm_source=x'), 'https://example.com/a');
  assert.equal(canonicalUrl('https://example.com/a?q=a%20b&x=1+2#frag'), 'https://example.com/a?q=a%20b&x=1+2#frag', 'other params keep their encoding');
  assert.equal(canonicalUrl('https://news.google.com/rss/articles/CBMi?oc=5'), 'https://news.google.com/rss/articles/CBMi?oc=5');
  assert.equal(canonicalUrl('http://user:pass@example.com/'), 'http://example.com/');
  assert.equal(canonicalUrl('/relative/path', 'https://feed.example/rss'), 'https://feed.example/relative/path');
  assert.equal(canonicalUrl('https://www.reddit.com/r/wii/comments/1/i_beat_lucía/'), 'https://www.reddit.com/r/wii/comments/1/i_beat_luc%C3%ADa/');
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'mailto:a@b.c', 'ftp://x.example/', '', null, 'not a url', '//no-scheme.example/x']) {
    assert.equal(canonicalUrl(bad), null, String(bad));
  }
  assert.equal(canonicalUrl('javascript:alert(1)', 'https://feed.example/'), null);
  assert.ok(isHttpUrl('https://x.example/'));
  assert.ok(!isHttpUrl('javascript:alert(1)'));
});

test('parseDate understands RFC 822, ISO 8601 and common variants', () => {
  const cases = [
    ['Wed, 04 Nov 2026 16:15:00 GMT', '2026-11-04T16:15:00.000Z'],
    ['Wed, 04 Nov 2026 06:08:00 +0000', '2026-11-04T06:08:00.000Z'],
    ['Wed, 4 Nov 2026 06:08:00 -0500', '2026-11-04T11:08:00.000Z'],
    ['Tue, 03 Nov 2026 12:00:00 PST', '2026-11-03T20:00:00.000Z'],
    ['Tue, 03 Nov 2026 08:00:00 EST', '2026-11-03T13:00:00.000Z'],
    ['1 Nov 26 10:00 +0100', '2026-11-01T09:00:00.000Z'],
    ['04 November 2026 16:15:00 UT', '2026-11-04T16:15:00.000Z'],
    ['Wed, 04 Nov 2026 16:15:00 +0000 (UTC)', '2026-11-04T16:15:00.000Z'],
    ['2026-09-24T04:36:38+00:00', '2026-09-24T04:36:38.000Z'],
    ['2026-10-08T02:39:22.834000+00:00', '2026-10-08T02:39:22.834Z'],
    ['2026-11-03T10:15:30+05:30', '2026-11-03T04:45:30.000Z'],
    ['2026-11-02 08:00:00', '2026-11-02T08:00:00.000Z'],
    ['2026-11-01', '2026-11-01T00:00:00.000Z'],
    ['2026-11-04T16:17:00Z', '2026-11-04T16:17:00.000Z'],
    ['November 4, 2026 4:17 PM GMT', '2026-11-04T16:17:00.000Z'],
  ];
  for (const [input, iso] of cases) assert.equal(new Date(parseDate(input)).toISOString(), iso, input);
  for (const bad of ['', 'not a date', '2', 'Sun, 01 Nov 2026 25:61:00 GMT', '2026-02-31', 'Thu, 01 Jan 1970 00:00:00 GMT', null, undefined, 'Wii 2']) {
    assert.equal(parseDate(bad), null, String(bad));
  }
});

test('prettifyPublisher and splitPublisherSuffix clean Google News publishers', () => {
  assert.equal(prettifyPublisher('www.wargamer.com'), 'wargamer.com');
  assert.equal(prettifyPublisher('  BGR '), 'BGR');
  assert.equal(prettifyPublisher('<b onmouseover="alert(1)">Evil</b> &amp; Co'), 'Evil & Co');
  assert.equal(prettifyPublisher('x'.repeat(300)).length <= 100, true);
  assert.deepEqual(splitPublisherSuffix('5 Classic Nintendo Wii Games - SVG', 'SVG'), { headline: '5 Classic Nintendo Wii Games', publisher: 'SVG' });
  assert.deepEqual(splitPublisherSuffix('Wii - The Story - www.wargamer.com', 'www.wargamer.com'), { headline: 'Wii - The Story', publisher: 'www.wargamer.com' });
  assert.deepEqual(splitPublisherSuffix('Wii - Not the publisher', 'Kotaku'), { headline: 'Wii - Not the publisher', publisher: 'Kotaku' });
  assert.deepEqual(splitPublisherSuffix('Headline - Some Site', ''), { headline: 'Headline', publisher: 'Some Site' });
  assert.deepEqual(splitPublisherSuffix('No suffix here', ''), { headline: 'No suffix here', publisher: '' });
});

test('titleKey folds case, punctuation and accents and drops a publisher suffix', () => {
  assert.equal(titleKey('Pokémon: The "Best" Wii Game!'), 'pokemon the best wii game');
  assert.equal(titleKey('Wii Sports Turns 20 - Nintendo Life', ['Nintendo Life']), titleKey('Wii Sports turns 20'));
  assert.equal(titleKey('Wii’s Story | Kotaku', ['Kotaku']), 'wiis story');
  assert.equal(titleKey('Bill & Ted'), titleKey('Bill and Ted'));
  assert.equal(foldText('🎮'), '');
});

test('normalizeEntry: Google News items get the publisher, "via" and no excerpt', async () => {
  const feed = await fixture('googlenews.xml');
  const src = source('googlenews');
  const all = feed.items.map((r) => normalizeEntry(r, src));
  const svg = all.find((n) => n.title === '5 Classic Nintendo Wii Games That Are Unplayable Today');
  assert.ok(svg, 'publisher suffix removed from the title');
  assert.equal(svg.source, 'SVG');
  assert.equal(svg.via, 'Google News');
  assert.equal(svg.excerpt, '');
  assert.match(svg.url, /^https:\/\/news\.google\.com\/rss\/articles\//);
  assert.equal(new Date(svg.published).toISOString(), '2026-10-26T07:00:00.000Z');
  const wargamer = all.find((n) => /Board/.test(n.title));
  assert.equal(wargamer.source, 'wargamer.com');
  assert.ok(!/wargamer/.test(wargamer.title));
  for (const n of all) assert.ok(!/ - (SVG|BGR|Kotaku|CNET)$/.test(n.title), n.title);
});

test('normalizeEntry: Reddit excerpts lose the "submitted by" boilerplate', async () => {
  const feed = await fixture('reddit-wii.xml');
  const src = source('reddit-wii');
  const all = feed.items.map((r) => normalizeEntry(r, src));
  assert.equal(all.length, feed.items.length);
  for (const n of all) {
    assert.equal(n.source, 'r/wii');
    assert.equal(n.via, undefined);
    assert.ok(!/submitted by|\[link\]|\[comments\]|SC_OFF/.test(n.excerpt), n.excerpt);
    assert.ok(n.excerpt.length <= EXCERPT_MAX);
    assert.match(n.url, /^https:\/\/www\.reddit\.com\/r\/wii\/comments\//);
  }
  const lucia = all.find((n) => /Lucía/.test(n.title));
  assert.match(lucia.url, /luc%C3%ADa/);
  assert.match(lucia.excerpt, /^I got to 1400 skill rating/);
});

test('normalizeEntry: publisher feeds keep clean excerpts', async () => {
  for (const [file, id] of [['nintendolife.xml', 'nintendolife'], ['timeextension.xml', 'timeextension'], ['nintendoeverything.xml', 'nintendoeverything'], ['hackaday.xml', 'hackaday'], ['dolphin.xml', 'dolphin'], ['gonintendo.xml', 'gonintendo']]) {
    const feed = await fixture(file);
    for (const raw of feed.items) {
      const n = normalizeEntry(raw, source(id));
      assert.ok(n, `${file}: ${raw.title}`);
      assert.ok(n.excerpt.length <= EXCERPT_MAX);
      assert.ok(!/full article on|appeared first on|read more|<[a-z]/i.test(n.excerpt), `${file}: ${n.excerpt}`);
      assert.equal(n.title, n.title.trim());
      assert.ok(Number.isFinite(n.published), `${file}: date`);
    }
  }
});

test('normalizeEntry drops entries without an http(s) link', () => {
  const src = { id: 'x', name: 'X', url: 'https://x.example/feed', tab: 'scene' };
  assert.equal(normalizeEntry({ title: 'Wii', link: 'javascript:alert(1)' }, src), null);
  assert.equal(normalizeEntry({ title: 'Wii', link: '' }, src), null);
  assert.equal(normalizeEntry({ title: '', link: 'https://x.example/a' }, src), null);
  assert.equal(normalizeEntry({ title: 'Wii', link: '/a' }, src).url, 'https://x.example/a');
});
