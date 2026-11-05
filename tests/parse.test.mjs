import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { decodeBody, detectCharset, normalizeCharset } from '../scripts/lib/fetch.mjs';
import { cleanTitle, cleanExcerpt, parseDate } from '../scripts/lib/text.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = async (name) => parseFeed(decodeBody(await readFile(path.join(FIX, name))).text);

test('every live source fixture parses', async () => {
  const expected = {
    'nintendolife.xml': ['rss', 12, 'Nintendo Life | Latest Updates'],
    'gonintendo.xml': ['rss', 12, 'GoNintendo'],
    'nintendoeverything.xml': ['rss', 10, 'Nintendo Everything'],
    'timeextension.xml': ['rss', 12, 'Time Extension | Latest Updates'],
    'googlenews.xml': ['rss', 12, '""Nintendo Wii"" - Google News'],
    'hackaday.xml': ['rss', 7, 'wii – Hackaday'],
    'dolphin.xml': ['atom', 12, 'dolphin-emu.org - Last entries'],
    'reddit-wii.xml': ['atom', 12, 'Wii games and scene news'],
    'reddit-wiihacks.xml': ['atom', 12, 'A Reddit Community for Hacking the Nintendo Wii'],
  };
  for (const [file, [format, count, title]] of Object.entries(expected)) {
    const feed = await load(file);
    assert.equal(feed.format, format, file);
    assert.equal(feed.items.length, count, file);
    assert.equal(feed.title, title, file);
    for (const it of feed.items) {
      assert.ok(it.title, `${file}: title`);
      assert.match(it.link, /^https:\/\//, `${file}: link`);
      assert.ok(parseDate(it.published) || parseDate(it.updated), `${file}: date ${it.published}`);
      assert.ok(Array.isArray(it.categories));
    }
  }
});

test('RSS 2.0 fields: Nintendo Life, Nintendo Everything, Hackaday', async () => {
  const nl = await load('nintendolife.xml');
  const first = nl.items[0];
  assert.equal(first.title, "Pokémon Pokopia's Limited-Time 'Apples To Applin' Event Begins This Month");
  assert.equal(first.link, 'https://www.nintendolife.com/news/2026/11/pokemon-pokopias-limited-time-apples-to-applin-event-begins-this-month');
  assert.equal(first.published, 'Wed, 04 Nov 2026 16:15:00 GMT');
  assert.equal(first.guid, 'https://www.nintendolife.com/#article-208623');
  assert.match(first.description, /^<p><strong>Applin of my eye\.<\/strong><\/p>/, 'CDATA payload kept as HTML');

  const ne = await load('nintendoeverything.xml');
  assert.equal(ne.items[0].title, 'Fire Emblem: Fortune’s Weave gets more datamine details, including new characters and variations');
  assert.equal(ne.items[0].author, 'Carlos');
  assert.deepEqual(ne.items[0].categories.slice(0, 2), ['News', 'Switch 2']);

  const hd = await load('hackaday.xml');
  assert.equal(hd.items[0].title, 'You’ve All Seen A Hackintosh, But Have You Seen One On A Wii?');
  assert.match(hd.items[0].content, /Bryan Keller/, 'content:encoded parsed');
  assert.ok(hd.items[0].categories.includes('Nintendo Wii Hacks'));
});

test('Google News: <source> gives the publisher name and URL', async () => {
  const feed = await load('googlenews.xml');
  const svg = feed.items[0];
  assert.equal(svg.title, '5 Classic Nintendo Wii Games That Are Unplayable Today - SVG');
  assert.equal(svg.sourceName, 'SVG');
  assert.equal(svg.sourceUrl, 'https://www.svg.com');
  assert.match(svg.link, /^https:\/\/news\.google\.com\/rss\/articles\/.+\?oc=5$/);
  const abc = feed.items.find((i) => i.sourceUrl === 'https://www.abc.net.au');
  assert.equal(abc.sourceName, 'ABC News & Headlines – Australian Broadcasting Corporation', 'entities decoded');
});

test('Atom: Dolphin and Reddit', async () => {
  const dolphin = await load('dolphin.xml');
  assert.equal(dolphin.items[0].title, 'Dolphin Progress Report: Release 2609');
  assert.equal(dolphin.items[0].link, 'https://dolphin-emu.org/blog/2026/09/24/dolphin-progress-report-release-2609/');
  assert.equal(dolphin.items[0].published, '2026-09-24T04:36:38+00:00');
  assert.equal(dolphin.items[0].updated, '2026-10-08T02:39:22.834000+00:00');
  assert.equal(dolphin.items[0].author, 'JosJuice');
  assert.match(dolphin.items[0].description, /^<header>/, 'summary type="html" decoded once');
  assert.ok(dolphin.items.some((i) => i.title === 'Dolphin Progress Report: Release 2407 and 2409'));

  const reddit = await load('reddit-wii.xml');
  const lucia = reddit.items.find((i) => i.title === 'I beat Lucía in wii sports resort');
  assert.equal(lucia.link, 'https://www.reddit.com/r/wii/comments/1xnqixk/i_beat_lucía_in_wii_sports_resort/');
  assert.equal(lucia.author, '/u/Livid-Seat257');
  assert.equal(lucia.guid, 't3_1xnqixk');
  assert.match(lucia.content, /submitted by/);
  assert.deepEqual(lucia.categories, ['r/wii']);
  assert.ok(reddit.items.some((i) => /^Memery Monday/.test(i.title)));
});

test('an HTML page is not a feed (the GoNintendo /feeds directory page)', async () => {
  const page = await load('edge-html-page.xml');
  assert.deepEqual(page, { format: 'unknown', title: '', items: [] });
});

test('entities: named, numeric, double-encoded and unescaped ampersands', async () => {
  const feed = await load('edge-entities.xml');
  assert.equal(feed.title, 'Edge & Entities');
  const [a, b, c] = feed.items;
  assert.equal(cleanTitle(a.title), 'Wii’s 20th: Nintendo’s — best & brightest years');
  assert.equal(a.link, 'https://edge.example/a?utm_source=rss&utm_medium=feed&id=1&fbclid=XYZ');
  assert.equal(cleanExcerpt(a.description), 'Café & Wii “quotes”');
  assert.equal(cleanTitle(b.title), 'Mario & Luigi: unescaped ampersand &bogus; – dash on the Wii');
  assert.equal(cleanExcerpt(b.description), 'Plain text with 5 < 6 and AT&T');
  assert.equal(cleanTitle(c.title), 'Double encoded ’Wii’ & friends');
  assert.equal(cleanExcerpt(c.description), '', 'only the WordPress footer, which is removed');
});

test('CDATA: literal text, mixed sections, markup-looking content', async () => {
  const feed = await load('edge-cdata.xml');
  assert.equal(feed.items.length, 2, 'a CDATA "</item>" and a commented <item> do not split items');
  assert.equal(feed.title, 'CDATA & Co');
  const [a, b] = feed.items;
  assert.equal(a.title, 'Wii <b>bold</b> & raw ampersand');
  assert.equal(cleanTitle(a.title), 'Wii bold & raw ampersand');
  assert.equal(a.link, 'https://edge.example/cdata-1');
  assert.equal(a.description, 'Before <em>inside &amp; literal</em> after & decoded');
  assert.equal(a.content, '<p>Content with </item> and <title>fake</title> inside CDATA</p>');
  assert.equal(a.author, 'Jane Doe');
  assert.deepEqual(a.categories, ['Wii', 'Homebrew']);
  assert.equal(b.title, 'Second part joined', 'commented-out title ignored');
  assert.equal(b.description, 'one two');
});

test('Atom link variants and content types', async () => {
  const feed = await load('edge-atom-links.xml');
  assert.equal(feed.format, 'atom');
  assert.deepEqual(
    feed.items.map((i) => i.link),
    ['https://edge.example/posts/1', 'https://edge.example/posts/2?a=1&b=2', 'https://edge.example/related/3', 'https://edge.example/posts/4', 'https://edge.example/posts/5'],
  );
  const [one, two, three, four] = feed.items;
  assert.equal(one.description, 'Summary one');
  assert.equal(two.published, '');
  assert.equal(two.updated, '2026-11-02T09:00:00+02:00');
  assert.equal(two.content, '<p>Escaped <b>HTML</b> content</p>');
  assert.equal(three.published, '2026-11-01T08:00:00Z', 'Atom 0.3 <issued>');
  assert.equal(three.content, '<div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <strong>XHTML</strong> &amp; more</p></div>', 'xhtml kept as markup');
  assert.equal(cleanTitle(four.title), 'Two alternates', 'a <source><title> before the entry title does not win');
  assert.equal(four.sourceName, 'Original Publisher');
  assert.equal(four.sourceUrl, 'https://publisher.example/');
  assert.equal(four.author, 'Atom Author');
  assert.deepEqual(four.categories, ['Wii', 'homebrew']);
});

test('RSS 1.0 (RDF)', async () => {
  const feed = await load('edge-rdf.xml');
  assert.equal(feed.format, 'rdf');
  assert.equal(feed.title, 'RDF Site Summary');
  assert.equal(feed.items.length, 2);
  const [a, b] = feed.items;
  assert.equal(a.title, 'RDF item about the Wii Remote');
  assert.equal(a.published, '2026-11-01T12:00:00-05:00');
  assert.equal(a.author, 'RDF Author');
  assert.equal(a.content, '<p>Full <em>content</em></p>');
  assert.deepEqual(a.categories, ['Wii']);
  assert.equal(b.link, 'https://edge.example/rdf/2', 'falls back to rdf:about');
  assert.equal(b.guid, 'https://edge.example/rdf/2');
});

test('byte order mark and windows-1252 are decoded', async () => {
  const bomBytes = await readFile(path.join(FIX, 'edge-bom.xml'));
  assert.deepEqual([...bomBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const bom = parseFeed(decodeBody(bomBytes).text);
  assert.equal(bom.items[0].title, 'Café owners love the Wii');
  assert.equal(parseFeed(bomBytes.toString('utf8')).items.length, 1, 'a BOM left in the string is tolerated too');

  const cpBytes = await readFile(path.join(FIX, 'edge-windows-1252.xml'));
  assert.equal(detectCharset(cpBytes), 'windows-1252');
  const cp = parseFeed(decodeBody(cpBytes).text);
  assert.equal(cp.items[0].title, 'Nintendo’s Wii “classics” – café €5');
});

test('charset detection: header first, then XML declaration, UTF-8 default; mislabeled UTF-8 survives', () => {
  const utf8 = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Pokémon</title></item></channel></rss>', 'utf8');
  assert.equal(detectCharset(utf8), 'windows-1252');
  assert.equal(decodeBody(utf8).charset, 'utf-8', 'valid UTF-8 labelled latin-1 is decoded as UTF-8');
  assert.match(decodeBody(utf8).text, /Pokémon/);
  assert.equal(detectCharset(Buffer.from('<rss/>'), 'application/rss+xml; charset=ISO-8859-1'), 'windows-1252');
  assert.equal(detectCharset(Buffer.from('<rss/>'), 'text/xml; charset="utf-8"'), 'utf-8');
  assert.equal(detectCharset(Buffer.from('<rss/>')), 'utf-8');
  assert.equal(normalizeCharset('US-ASCII'), 'windows-1252');
  assert.equal(decodeBody(Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00])).text, '<a');
  assert.equal(decodeBody(Buffer.from('<a/>'), 'text/xml; charset=x-unknown-charset').charset, 'utf-8');
});

test('malformed XML: unclosed elements, stray tags, garbage after the root', async () => {
  const feed = await load('edge-malformed.xml');
  assert.equal(feed.format, 'rss');
  assert.equal(feed.title, 'Broken & proud');
  assert.deepEqual(feed.items.map((i) => i.title), ['Unclosed title about the Wii', 'Item that closes', 'Good item']);
  assert.equal(feed.items[0].link, 'https://edge.example/broken-1');
  assert.equal(cleanExcerpt(feed.items[0].description), 'Unescaped & ampersand stray tag');
});

test('dates are returned raw; dc:date and atom:updated are found', async () => {
  const feed = await load('edge-dates.xml');
  const by = Object.fromEntries(feed.items.map((i) => [i.link.split('/').pop(), i]));
  assert.equal(by.missing.published, '');
  assert.equal(by.invalid.published, 'not a date');
  assert.equal(by.dc.published, '2026-10-31T09:00:00Z');
  assert.equal(by.updated.published, '');
  assert.equal(by.updated.updated, '2026-10-30T06:00:00Z');
});

test('parseFeed never throws', () => {
  const inputs = [
    null, undefined, '', 42, {}, [], 'plain text', '<', '<<<>>>', '<rss', '<rss><channel><item>', '<feed><entry><link href="',
    '<?xml version="1.0"?>', '<![CDATA[', '<!-- unterminated', '<rss><channel><item><title><![CDATA[x</title></item></channel></rss>',
    '<rss>' + '<item><title>x</title>'.repeat(2000), `<rss><channel><item><title>${'<b>'.repeat(5000)}</title></item></channel></rss>`,
    String.fromCharCode(0, 1, 2, 0xfffe, 0xd800),
  ];
  for (const input of inputs) {
    const out = parseFeed(input);
    assert.ok(['rss', 'atom', 'rdf', 'unknown'].includes(out.format));
    assert.ok(Array.isArray(out.items));
  }
  assert.deepEqual(parseFeed('just some text'), { format: 'unknown', title: '', items: [] });
});
