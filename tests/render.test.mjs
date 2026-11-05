// scripts/lib/render.mjs against the real template: escaping, links, hooks, determinism, dates and states.
// See docs/ARCHITECTURE.md section 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { renderPage, escapeHtml, safeUrl, ageLine, quietPhrase, statusLine, inDisplayFace, DISPLAY_COVERAGE, FURTHER, CAPTIONS } from '../scripts/lib/render.mjs';
import { fontCoverage } from '../tools/font-coverage.mjs';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { normalizeEntry } from '../scripts/lib/text.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = await readFile(path.join(ROOT, 'templates/index.html'), 'utf8');
const NOW = new Date('2026-11-04T17:22:00Z');
const SITE = {
  url: 'https://wiivolve.com',
  name: 'WiiVolve',
  tagline: 'Still spinning since 2006.',
  description: 'Fresh Nintendo Wii news and homebrew scene activity, gathered every hour.',
  author: 'Ali Kurnaz',
  since: 2006,
  wiiLaunch: '2006-11-19',
};

let n = 0;
const item = (over = {}) => {
  n += 1;
  const published = over.published ?? '2026-11-04T15:06:02Z';
  return {
    id: `a${String(n).padStart(11, '0')}`,
    title: `Story ${n} about the Wii`,
    url: `https://example.com/story-${n}`,
    source: 'r/wii',
    sourceId: 'reddit-wii',
    tab: 'scene',
    published,
    firstSeen: over.firstSeen ?? published,
    excerpt: `Excerpt ${n}.`,
    matched: [],
    ...over,
  };
};
const archiveItem = (over = {}) => ({
  id: `wv-${++n}`,
  title: `Old post ${n}`,
  url: 'https://web.archive.org/web/20070703152325/http://wiivolve.com/',
  source: 'WiiVolve',
  sourceId: 'wiivolve',
  tab: 'archive',
  kind: 'post',
  published: '2007-06-27T12:00:00Z',
  firstSeen: '2007-06-27T12:00:00Z',
  excerpt: 'Meet your friendly Wii Shop Channel’s WiiWare section.',
  matched: [],
  ...over,
});

function fixtures() {
  const news = {
    version: 1,
    generatedAt: '2026-11-04T17:22:00Z',
    items: [
      item({ published: '2026-11-04T15:06:02Z', firstSeen: '2026-11-04T17:22:00Z' }),
      item({ published: '2026-11-04T07:59:08Z' }),
      item({ published: '2026-11-03T12:47:51Z' }),
      item({ published: '2026-10-31T22:47:07Z', source: 'r/WiiHacks', sourceId: 'reddit-wiihacks' }),
      item({ published: '2026-10-26T07:00:00Z', tab: 'press', source: 'SVG', sourceId: 'googlenews', via: 'Google News', excerpt: '' }),
      item({ published: '2026-09-24T04:36:38Z', source: 'Dolphin Emulator', sourceId: 'dolphin', title: 'Dolphin Progress Report: Release 2609', url: 'https://dolphin-emu.org/blog/2026/09/24/dolphin-progress-report-release-2609/' }),
      item({ published: '2026-07-10T07:00:00Z', tab: 'press', source: 'BGR', sourceId: 'googlenews', via: 'Google News' }),
    ],
    meta: {
      dolphin: { version: '2609', url: 'https://dolphin-emu.org/blog/2026/09/24/dolphin-progress-report-release-2609/', published: '2026-09-24T04:36:38Z' },
      counts: { press: 2, scene: 5 },
      // A window that holds every story, and nothing left out: every gap is a real one.
      windowStart: '2026-07-01T00:00:00Z',
      completeSince: { all: '2026-07-01T00:00:00Z', press: '2026-07-01T00:00:00Z', scene: '2026-07-01T00:00:00Z' },
    },
  };
  const archive = {
    version: 1,
    items: [
      archiveItem({ title: 'WiiVolve Reconstruction Plan', published: '2008-03-01T12:00:00Z', firstSeen: '2008-03-01T12:00:00Z', note: 'The final post' }),
      archiveItem(),
      archiveItem({ title: 'New Site Coming Soon', kind: 'milestone', note: 'Where it all started', published: '2006-08-26T12:00:00Z', firstSeen: '2006-08-26T12:00:00Z', url: 'https://web.archive.org/web/20060826001626/http://wiivolve.com/' }),
    ],
  };
  const health = {
    version: 1,
    generatedAt: '2026-11-04T17:22:00Z',
    sources: [
      { id: 'nintendolife', name: 'Nintendo Life', tab: 'press', homepage: 'https://www.nintendolife.com', status: 'ok', lastOk: '2026-11-04T17:22:00Z', failures: 0, items: 0, httpStatus: 200, error: null, ms: 300 },
      { id: 'reddit-wii', name: 'r/wii', tab: 'scene', homepage: 'https://www.reddit.com/r/wii/', status: 'stale', lastOk: '2026-11-04T16:22:00Z', failures: 1, items: 3, httpStatus: 429, error: 'HTTP 429', ms: 100 },
      { id: 'dolphin', name: 'Dolphin Emulator', tab: 'scene', homepage: 'https://dolphin-emu.org/blog/', status: 'ok', lastOk: '2026-11-04T17:22:00Z', failures: 0, items: 1, httpStatus: 304, error: null, ms: 90 },
    ],
    summary: { ok: 3, total: 3 },
  };
  return { news, archive, health };
}

const BASE = fixtures();
const render = (over = {}) => renderPage({ template: TEMPLATE, news: BASE.news, archive: BASE.archive, health: BASE.health, site: SITE, now: NOW, ...over });
const tagsOf = (html) => html.match(/<[a-zA-Z][^>]*>/g) || [];
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('escapeHtml escapes the five HTML specials and stringifies safely', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('safeUrl keeps http(s) and refuses everything else', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl(' http://example.com '), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com/', '/relative', 'example.com', '', null, 42, 'vbscript:x']) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('injection canaries: hostile feed text is escaped, never markup, never a script or handler', () => {
  const f = fixtures();
  const evil = item({
    title: '<script>alert(1)</script><img src=x onerror=alert(2)> & "quotes"',
    url: 'javascript:alert(3)',
    source: '<b onmouseover=alert(4)>Bad</b>',
    via: '<svg onload=alert(5)>',
    excerpt: '</p><style>body{}</style><iframe src="javascript:alert(6)">',
    note: '<i>note</i>',
    id: '"><script>x</script>',
  });
  const html = renderPage({ template: TEMPLATE, news: { ...f.news, items: [evil, ...f.news.items] }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  for (const raw of ['<script>alert', '<img src=x', '<b onmouseover', '<svg', '<style>body', '<iframe', '<i>note', '"><script>']) assert.ok(!html.includes(raw), raw);
  assert.ok(!tagsOf(html).some((t) => /javascript:/i.test(t)), 'no javascript: in any tag or attribute');
  assert.ok(html.includes('&lt;iframe src=&quot;javascript:alert(6)&quot;&gt;'), 'hostile excerpt markup shows as text');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the hostile title is shown, escaped');
  assert.ok(!tagsOf(html).some((t) => /\son[a-z]+\s*=/i.test(t)), 'no on*= attributes');
  // The item without a usable URL renders its headline as text, not a link.
  assert.match(html, /<span class="hl">&lt;script&gt;alert\(1\)/);
});

test('links are http(s), site-relative or in-page only', () => {
  const html = render();
  const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.ok(hrefs.length > 20);
  for (const h of hrefs) assert.ok(/^(https?:\/\/|\/(?!\/)|#)/.test(h), h);
  // Every headline link opens the source with rel="noopener".
  for (const t of tagsOf(html).filter((t) => /class="hl"/.test(t) && t.startsWith('<a'))) assert.match(t, /rel="noopener"/);
});

test('CSP-safe markup: no inline styles, style elements, inline scripts or handlers', () => {
  const html = render();
  const tags = tagsOf(html);
  assert.ok(!tags.some((t) => /\sstyle\s*=/i.test(t)), 'style attribute');
  assert.ok(!/<style[\s>]/i.test(html), '<style> element');
  // Every script is external from an origin the CSP allows, or the JSON-LD data block. (RUNBOOK may add the
  // Cloudflare Web Analytics beacon, which is external too.)
  const scripts = tags.filter((t) => /^<script\b/i.test(t));
  assert.ok(scripts.includes('<script type="module" src="/app.js">'));
  for (const t of scripts) assert.ok(/\ssrc\s*=\s*["'](\/(?!\/)|https:\/\/static\.cloudflareinsights\.com\/)/.test(t) || /type="application\/ld\+json"/.test(t), t);
  assert.ok(!tags.some((t) => /\son[a-z]+\s*=/i.test(t)), 'on*= handler');
  assert.ok(!/<svg[\s/>]/i.test(html), 'no inline SVG');
});

test('every hook from section 6.1 is present with the right element', () => {
  const html = render();
  assert.match(html, /<main id="main">/);
  assert.match(html, /<button class="console" id="console" type="button" aria-label="Jump to the newest story"/);
  for (const id of ['stream', 'deep-end', 'archive', 'about', 'status']) assert.match(html, new RegExp(`\\sid="${id}"`), id);
  assert.match(html, /<input id="search" type="search"/);
  assert.match(html, /<div class="about" id="about" popover role="dialog"/);
  assert.match(html, /popovertarget="about"/);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
  const items = tagsOf(html).filter((t) => /\sdata-item[\s>]/.test(t));
  for (const t of items) for (const a of ['data-id', 'data-tab', 'data-source', 'data-published', 'data-first-seen']) assert.match(t, new RegExp(`\\s${a}="`), `${a} in ${t}`);
  // Every item carries a time[datetime].
  const lis = html.match(/<li class="it[^"]*" data-item[\s\S]*?<\/li>/g);
  assert.equal(lis.length, items.length);
  for (const li of lis) assert.match(li, /<time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ">/);
});

test('head carries the required meta, links and JSON-LD', () => {
  const html = render();
  const head = html.split('</head>')[0];
  for (const re of [/<meta charset="utf-8">/, /name="viewport"/, /<title>WiiVolve — Wii news, WiiVolving around you since 2006<\/title>/, /name="description"/, /rel="canonical" href="https:\/\/wiivolve.com\/"/,
    /property="og:title"/, /property="og:description"/, /property="og:image" content="https:\/\/wiivolve.com\/og.png"/, /property="og:url"/, /property="og:type"/, /name="twitter:card" content="summary_large_image"/,
    /name="theme-color" content="#fbfbfc" media="\(prefers-color-scheme: light\)"/, /name="theme-color" content="#121a2e" media="\(prefers-color-scheme: dark\)"/,
    /type="application\/rss\+xml"/, /type="application\/feed\+json"/, /rel="manifest"/, /rel="icon" href="\/favicon.svg" type="image\/svg\+xml"/, /rel="apple-touch-icon" href="\/apple-touch-icon.png"/,
    /rel="preload" href="\/fonts\/bricolage-grotesque-96.woff2" as="font" type="font\/woff2" crossorigin/, /href="\/style.css"/, /href="\/print.css" media="print"/]) {
    assert.match(head, re);
  }
  const ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.url, 'https://wiivolve.com/');
});

test('the item count equals live plus archive items, each rendered once', () => {
  const f = BASE;
  const html = render();
  const ids = [...html.matchAll(/\sdata-id="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(ids.length, f.news.items.length + f.archive.items.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const it of [...f.news.items, ...f.archive.items]) assert.ok(ids.includes(it.id), it.id);
  assert.match(html, /<span class="n" id="n-all">7<\/span>/);
  assert.match(html, /<span class="n" id="n-press">2<\/span>/);
  assert.match(html, /<span class="n" id="n-scene">5<\/span>/);
});

test('rendering is deterministic and ignores the clock', () => {
  const a = render();
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse('2031-01-01T00:00:00Z');
    assert.equal(render(), a);
  } finally {
    Date.now = realNow;
  }
});

test('age line: countdown before, birthday on, age after November 19 (UTC)', () => {
  const at = (iso) => ageLine(Date.parse(iso), '2006-11-19');
  assert.deepEqual([at('2026-11-04T17:22:00Z').text, at('2026-11-04T17:22:00Z').birthday], ['20 years in 15 days.', false]);
  assert.equal(at('2026-11-18T23:59:59Z').text, '20 years in 1 day.');
  assert.deepEqual([at('2026-11-19T00:00:00Z').text, at('2026-11-19T00:00:00Z').birthday], ['Happy birthday,\u00a0Wii. 20 today.', true]);
  assert.equal(at('2026-11-19T23:59:59Z').text, 'Happy birthday,\u00a0Wii. 20 today.');
  assert.deepEqual([at('2026-11-20T00:00:00Z').text, at('2026-11-20T00:00:00Z').birthday], ['20 years and 1 day old.', false]);
  assert.equal(at('2027-03-01T08:00:00Z').text, '20 years and 102 days old.');
  assert.equal(at('2027-11-18T12:00:00Z').text, '20 years and 364 days old.');
  assert.equal(at('2027-11-19T12:00:00Z').text, 'Happy birthday,\u00a0Wii. 21 today.');
  assert.equal(at('2028-11-21T12:00:00Z').text, '22 years and 2 days old.');
});

test('the page shows the age line, birthday mode and its party sheet for the build date', () => {
  const before = render();
  assert.match(text(before), /20 years in 15 days\./);
  assert.match(before, /<html lang="en">/);
  assert.ok(!before.includes('/party.css'));
  // The idle caption promises a glow only app.js lights, so the HTML leaves it to the script.
  assert.match(before, /<p class="cap" id="cap" data-idle="The slot glows when something new arrives\." [^>]*><\/p>/);
  const bday = render({ now: new Date('2026-11-19T15:00:00Z') });
  assert.match(bday, /<html lang="en" class="bday">/);
  assert.match(text(bday), /Happy birthday, Wii\. 20 today\./);
  assert.match(bday, /Happy birthday,\u00a0Wii\./, 'a no-break space keeps "Wii." with the greeting');
  assert.match(bday, /<link rel="stylesheet" href="\/party.css" id="party">/);
  assert.match(bday, /<p class="cap" id="cap"[^>]*>Party hat on, confetti out, slot glowing\.<\/p>/);
  const after = render({ now: new Date('2026-11-20T09:00:00Z') });
  assert.match(text(after), /20 years and 1 day old\./);
  assert.ok(!after.includes('class="bday"'));
});

test('quiet gaps are written out between groups a week or more apart', () => {
  assert.equal(quietPhrase(7), 'Seven quiet days.');
  assert.equal(quietPhrase(13), 'Thirteen quiet days.');
  assert.equal(quietPhrase(14), 'Two quiet weeks.');
  assert.equal(quietPhrase(32), 'Four quiet weeks.');
  assert.equal(quietPhrase(75), 'Two quiet months.');
  assert.equal(quietPhrase(364), 'Eleven quiet months.');
  assert.equal(quietPhrase(6838), 'Eighteen quiet years.');
  const html = render();
  // Oct 26 -> Sep 24 is 32 days; Sep 24 -> Jul 10 is 75 days; Oct 31 -> Oct 26 is 5 (no marker).
  const quiet = [...html.matchAll(/<p class="quiet">([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(quiet, ['Four quiet weeks.', 'Two quiet months.']);
  assert.match(html, /<section class="grp gap"><p class="quiet">Four quiet weeks\.<\/p><h3 class="grp-h">Sep 24<\/h3>/);
  // Each phrase also rides on its story for app.js: data-qa in All, data-qt in the story's own tab, where the
  // gap differs (Press: Oct 26 -> Jul 10 is 107 days; Scene: Oct 31 -> Sep 24 is 37).
  const attrs = [...html.matchAll(/data-published="([^"]+)"[^>]*?(?: data-qa="([^"]+)")?(?: data-qt="([^"]+)")?>/g)]
    .filter((m) => m[2] || m[3])
    .map((m) => [m[1].slice(0, 10), m[2] ?? null, m[3] ?? null]);
  assert.deepEqual(attrs, [
    ['2026-09-24', 'Four quiet weeks.', 'Five quiet weeks.'],
    ['2026-07-10', 'Two quiet months.', 'Three quiet months.'],
  ]);
  assert.ok(!html.includes('class="further"'), 'every story is inside the window: no "Further back" line');
});

test('quiet gaps are written only where the view is complete; the window ends with the "Further back" line (D9)', () => {
  const f = fixtures();
  const meta = (all, press = all, scene = all) => ({ ...f.news.meta, windowStart: '2026-10-21T17:22:00Z', completeSince: { all, press, scene } });
  const at = (m) => renderPage({ template: TEMPLATE, news: { ...f.news, meta: m }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  // A 14-day window: Sep 24 and Jul 10 are picks from further back, so the gaps above them say nothing.
  const html = at(meta('2026-10-21T17:22:00Z'));
  assert.ok(!html.includes('class="quiet"'), 'no quiet phrase between picks');
  assert.ok(!/data-q[at]=/.test(html));
  assert.equal((html.match(/class="further"/g) || []).length, 1);
  assert.match(html, new RegExp(`<section class="grp gap"><p class="further">${FURTHER}</p><h3 class="grp-h">Sep 24</h3><ul class="its"><li class="it" data-item data-id="[^"]+" data-tab="scene" data-source="Dolphin Emulator" data-published="2026-09-24T04:36:38Z"`));
  assert.match(html, /<div class="stream wrap" id="stream" data-window="2026-10-21T17:22:00Z">/);
  // A gap inside the window, but with a story left out above it in All (a capped source): the phrase stays only
  // in the tab whose list is complete there.
  const wide = { ...f.news.meta, windowStart: '2026-07-01T00:00:00Z' };
  const partial = renderPage({ template: TEMPLATE, news: { ...f.news, meta: { ...wide, completeSince: { all: '2026-10-01T00:00:00Z', press: '2026-07-01T00:00:00Z', scene: '2026-07-01T00:00:00Z' } } }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  assert.ok(!partial.includes('<p class="quiet">'), 'All is not complete below Oct 1');
  assert.match(partial, /data-published="2026-09-24T04:36:38Z" data-first-seen="[^"]+" data-qt="Five quiet weeks\.">/);
  // A pick from further back published on the same day as a story inside the window gets a group of its own.
  const sameDay = { ...f.news, items: [...f.news.items, item({ published: '2026-10-21T09:00:00Z', source: 'Hackaday', sourceId: 'hackaday' }), item({ published: '2026-10-21T20:00:00Z' })], meta: meta('2026-10-21T17:22:00Z') };
  const split = renderPage({ template: TEMPLATE, news: sameDay, archive: f.archive, health: f.health, site: SITE, now: NOW });
  const labels = [...split.matchAll(/<h3 class="grp-h">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(labels.filter((l) => l === 'Oct 21').length, 2);
  assert.match(split, new RegExp(`<p class="further">${FURTHER}</p><h3 class="grp-h">Oct 21</h3><ul class="its"><li class="it" data-item data-id="[^"]+" data-tab="scene" data-source="Hackaday" data-published="2026-10-21T09:00:00Z"`));
  // Without the window in news.meta (an older news.json) nothing is claimed.
  const bare = renderPage({ template: TEMPLATE, news: { ...f.news, meta: { counts: f.news.meta.counts } }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  assert.ok(!/class="(quiet|further)"/.test(bare));
});

test('stream groups in UTC: Today, Yesterday, weekday, date, then month', () => {
  const html = render();
  const labels = [...html.matchAll(/<h3 class="grp-h">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Today', 'Yesterday', 'Saturday', 'Oct 26', 'Sep 24', 'July 2026']);
  assert.deepEqual([...html.matchAll(/<h2 class="yr-h">(\d{4})<\/h2>/g)].map((m) => m[1]), ['2026', '2008', '2007', '2006']);
  // Recent items show a UTC clock, older ones a date.
  assert.match(html, /<time datetime="2026-11-04T15:06:02Z">15:06 UTC<\/time>/);
  assert.match(html, /<time datetime="2026-10-26T07:00:00Z">Oct 26<\/time>/);
});

test('items: source, via, Dolphin release tag, archive date bar and notes', () => {
  const html = render();
  assert.match(html, /<b>SVG<\/b><time datetime="2026-10-26T07:00:00Z">Oct 26<\/time><span class="via">via Google News<\/span>/);
  assert.match(html, /Dolphin Progress Report: Release 2609<\/a> <span class="note">Latest release<\/span>/);
  assert.match(html, /<a class="dol" href="https:\/\/dolphin-emu.org\/blog\/2026\/09\/24\/dolphin-progress-report-release-2609\/" rel="noopener">Latest Dolphin release: <b>2609<\/b><\/a>/);
  assert.match(html, /<span class="note">The final post<\/span><time datetime="2008-03-01T12:00:00Z"><span class="wd">Saturday, <\/span>March 1, 2008<\/time>/);
  // The last archive item is the origin, a milestone.
  assert.match(html, /<li class="it origin" data-item data-id="wv-\d+" data-tab="archive" data-source="WiiVolve"[^>]*><a class="hl" href="https:\/\/web.archive.org\/web\/20060826001626\/http:\/\/wiivolve.com\/" rel="noopener">New Site Coming Soon<\/a><p class="mt"><span class="note">Where it all started<\/span>/);
  assert.match(html, /<span>Milestone<\/span>/);
});

test('renderer guards: leaked CSS in excerpts, www. publishers, future dates', () => {
  const f = fixtures();
  const odd = [
    item({ excerpt: '.noscript-hide { display: none; } Welcome to Dolphin 2606.' }),
    item({ source: 'www.wargamer.com', tab: 'press', sourceId: 'googlenews' }),
    item({ published: '2030-01-01T00:00:00Z', firstSeen: '2026-11-04T17:00:00Z' }),
  ];
  const html = renderPage({ template: TEMPLATE, news: { ...f.news, items: [...odd, ...f.news.items] }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  assert.ok(!html.includes('noscript-hide'));
  assert.match(html, /<p class="ex">Welcome to Dolphin 2606\.<\/p>/);
  assert.match(html, /<b>wargamer\.com<\/b>/);
  assert.ok(!html.includes('2030'), 'a future date never opens a 2030 section');
});

test('empty news: a quiet stream, zero counts, the archive still there', () => {
  const f = fixtures();
  const html = renderPage({ template: TEMPLATE, news: { version: 1, generatedAt: '2026-11-04T17:22:00Z', items: [], meta: { dolphin: null, counts: { press: 0, scene: 0 } } }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  assert.match(html, /<div class="stream wrap" id="stream" data-window=""><p class="calm">The feeds are quiet right now\. The next check is within the hour\.<\/p><\/div>/);
  assert.match(html, /id="n-all">0</);
  assert.equal((html.match(/data-tab="archive"/g) || []).length, f.archive.items.length);
  assert.ok(!html.includes('class="dol"'), 'no Dolphin chip without meta.dolphin');
  // Missing inputs altogether still give a complete page.
  const bare = renderPage({ template: TEMPLATE, news: null, archive: null, health: null, site: null, now: NOW });
  assert.match(bare, /<main id="main">/);
  assert.match(bare, /Refreshed hourly/);
});

test('health: the status line, all-sources-down and the About source list', () => {
  const f = fixtures();
  // r/wii failed this hour ("Retrying" in the list below), so it is not counted as OK.
  assert.equal(statusLine(f.health), '2 of 3 sources OK · checked hourly');
  assert.equal(statusLine({ ...f.health, sources: f.health.sources.map((s) => ({ ...s, status: 'ok' })) }), '3 of 3 sources OK · checked hourly');
  assert.equal(statusLine({ summary: { ok: 2, total: 3 } }), '2 of 3 sources OK · checked hourly', 'the summary when there is no list');
  const html = render();
  assert.match(html, /<span id="status" data-generated="2026-11-04T17:22:00Z">2 of 3 sources OK · checked hourly<\/span>/);
  assert.match(html, /<h3>Sources <span class="ab-sum">2 of 3 sources OK · checked hourly<\/span><\/h3>/);
  assert.match(html, /<li class="s-stale"><span><a href="https:\/\/www.reddit.com\/r\/wii\/" rel="noopener">r\/wii<\/a><\/span><span>3 stories<\/span><span class="s-tab">Scene<\/span><span class="s-st">Retrying<\/span><\/li>/);
  const down = { ...f.health, sources: f.health.sources.map((s) => ({ ...s, status: 'down', failures: 3 })), summary: { ok: 0, total: 3 } };
  const htmlDown = renderPage({ template: TEMPLATE, news: f.news, archive: f.archive, health: down, site: SITE, now: NOW });
  assert.equal((htmlDown.match(/Sources unreachable right now\. Showing the last update\./g) || []).length, 2, 'footer and About');
  assert.equal((htmlDown.match(/class="s-down"/g) || []).length, 3);
  assert.match(htmlDown, /data-id="a\d+"/, 'the last items are still shown');
  // Every source failing this run (stale) is also "unreachable right now".
  const stale = { ...f.health, sources: f.health.sources.map((s) => ({ ...s, status: 'stale' })), summary: { ok: 3, total: 3 } };
  assert.equal(statusLine(stale), 'Sources unreachable right now. Showing the last update.');
});

test('the page links neither GitHub nor the JSON Feed, even with a repo in the config; the footer links RSS and About', () => {
  const html = render({ site: { ...SITE, repo: 'https://github.com/example/wiivolve/' } });
  assert.ok(!/github/i.test(html));
  assert.ok(!/<a [^>]*href="\/feed\.json"/.test(html));
  assert.match(html, /<link rel="alternate" type="application\/feed\+json"[^>]*href="\/feed\.json">/);
  const foot = html.match(/<nav class="foot-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal(foot, '<nav class="foot-nav" aria-label="Elsewhere"><a href="/feed.xml">RSS</a><button type="button" popovertarget="about">About</button></nav>');
});

test('the page stays under its 64 KB budget on a heavy day by shortening excerpts', async () => {
  const f = fixtures();
  const archive = JSON.parse(await readFile(path.join(ROOT, 'site/archive.json'), 'utf8'));
  const long = 'Wii homebrew channel classic controller remote console sensor bar emulator release progress report game collection '.repeat(3).slice(0, 219) + '…';
  // 60 live items (the cap) at realistic worst-case lengths, plus the real archive.
  const heavy = Array.from({ length: 60 }, (_, i) => {
    const google = i % 3 === 0;
    return item({
      title: `${'Nintendo Wii homebrew scene headline that runs fairly long '.repeat(2).slice(0, 96 + (i % 5) * 12)} ${i}`,
      url: google ? `https://news.google.com/rss/articles/${'CBMi'.padEnd(220, `x${i}`)}?oc=5` : `https://www.example.com/wii/2026/11/${'a-long-story-slug-'.repeat(4)}${i}`,
      published: new Date(NOW - i * 5.5 * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      excerpt: google ? '' : long,
      tab: google ? 'press' : 'scene',
      source: google ? 'Comic Book Resources' : 'r/WiiHacks',
      via: google ? 'Google News' : undefined,
    });
  });
  const big = renderPage({ template: TEMPLATE, news: { ...f.news, items: heavy }, archive, health: f.health, site: SITE, now: NOW });
  assert.ok(Buffer.byteLength(big) <= 63 * 1024, `${Buffer.byteLength(big)} bytes`);
  assert.equal((big.match(/\sdata-item[\s>]/g) || []).length, 60 + archive.items.length, 'no item is dropped');
  assert.ok(!big.includes(long), 'live excerpts were shortened');
  const kept = [...big.matchAll(/<p class="ex">([^<]*)<\/p>/g)].map((m) => m[1]).filter((x) => x.startsWith('Wii homebrew'));
  assert.ok(kept.length > 0 && kept.every((x) => x.endsWith('…') && x.length < long.length), 'shortened on a word boundary, not dropped');
  for (const it of archive.items) if (it.excerpt) assert.ok(big.includes(escapeHtml(it.excerpt)), `archive excerpt kept: ${it.id}`);
  // A normal day keeps every excerpt whole, and the guard is deterministic.
  const normal = fixtures();
  const html = renderPage({ template: TEMPLATE, news: normal.news, archive: normal.archive, health: normal.health, site: SITE, now: NOW });
  for (const it of normal.news.items) if (it.excerpt) assert.ok(html.includes(`<p class="ex">${it.excerpt}</p>`), it.id);
  assert.equal(renderPage({ template: TEMPLATE, news: { ...f.news, items: heavy }, archive, health: f.health, site: SITE, now: NOW }), big);
});

test('display face: the coverage constant is the font file’s, and fixed display copy is all in it (D12)', async () => {
  assert.equal(fontCoverage(path.join(ROOT, 'site', 'fonts', 'bricolage-grotesque-96.woff2')), DISPLAY_COVERAGE);
  assert.equal(inDisplayFace('WiiVolve: “…20 today.” × ~70 – é ß ’'), true);
  for (const s of ['Ōkami HD comes to Wii', 'Pricing ‰', 'Wii → Switch', 'Wii 🎮']) assert.equal(inDisplayFace(s), false, s);
  // Everything the page and the 404 set in the display face (style.css var(--fd)) besides feed headlines.
  const nf = await readFile(path.join(ROOT, 'site', '404.html'), 'utf8');
  const archive = JSON.parse(await readFile(path.join(ROOT, 'site', 'archive.json'), 'utf8'));
  const inner = (html, re) => [...html.matchAll(re)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  const fixed = [
    ...inner(TEMPLATE, /<h1 class="wordmark"[^>]*>([^<]*)</g),
    ...inner(TEMPLATE, /<h2 class="deep-h"[^>]*>([^<]*)</g),
    ...inner(TEMPLATE, /<blockquote><p>([^<]*)</g),
    ...inner(TEMPLATE, /<dd>([\s\S]*?)<\/dd>/g),
    ...inner(TEMPLATE, /<h2 id="about-h">([^<]*)</g),
    ...inner(TEMPLATE, /<h3>([^<]*)/g),
    ...inner(TEMPLATE, /<span aria-hidden="true">([^<]*)<\/span><\/button>/g),
    ...inner(TEMPLATE, /<span aria-hidden="true">(WiiVolve)<\/span>/g),
    ...inner(nf, /<h1 class="deep-h">([^<]*)</g),
    'WiiVolve · wiivolve.com', // print.css heading
    FURTHER,
    ...archive.items.map((i) => i.note).filter(Boolean),
    'New', 'Latest release', 'Feature', 'Review', 'Preview', 'Milestone', 'Today', 'Yesterday',
    'January February March April May June July August September October November December Sunday Monday Tuesday Wednesday Thursday Friday Saturday 0123456789',
  ];
  assert.ok(fixed.length >= 15 && fixed.includes('No disc inserted.') && fixed.includes('×'));
  for (let d = 7; d < 7000; d++) fixed.push(quietPhrase(d));
  for (const iso of ['2026-11-04T12:00:00Z', '2026-11-19T12:00:00Z', '2027-03-01T12:00:00Z']) fixed.push(ageLine(Date.parse(iso)).text);
  for (const s of fixed) assert.ok(inDisplayFace(s), `not in the display face: ${JSON.stringify(s)}`);
  // A press headline the face cannot draw is set in the system face, whole.
  const f = fixtures();
  const okami = item({ title: 'Ōkami returns', tab: 'press', source: 'IGN', sourceId: 'googlenews', via: 'Google News' });
  const html = renderPage({ template: TEMPLATE, news: { ...f.news, items: [okami, ...f.news.items] }, archive: f.archive, health: f.health, site: SITE, now: NOW });
  assert.match(html, /<a class="hl sys" href="https:\/\/example.com\/story-\d+" rel="noopener">Ōkami returns<\/a>/);
  assert.equal((html.match(/class="hl sys"/g) || []).length, 1);
});

test('page budget: a heavy day stays under 63 KB raw and 15.5 KB gzip by shortening excerpts', async () => {
  // Sixty real stories from the saved feeds (text that compresses like the real thing), an hour or two apart.
  const cfg = JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', 'feeds.json'), 'utf8'));
  const heavy = [];
  for (const src of cfg.sources) {
    const feed = parseFeed(await readFile(path.join(ROOT, 'tests', 'fixtures', `${src.id}.xml`), 'utf8'));
    feed.items.forEach((raw, k) => {
      const e = normalizeEntry(raw, src);
      if (!e) return;
      const published = new Date(NOW.getTime() - (heavy.length * 2 + k) * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
      heavy.push(item({ title: e.title, url: e.url, source: e.source, sourceId: src.id, via: e.via, tab: src.tab, published, excerpt: e.excerpt }));
    });
  }
  const f = fixtures();
  const archive = JSON.parse(await readFile(path.join(ROOT, 'site', 'archive.json'), 'utf8')); // the real deep end
  const html = renderPage({ template: TEMPLATE, news: { ...f.news, items: heavy.slice(0, 60) }, archive, health: f.health, site: SITE, now: NOW });
  assert.ok(Buffer.byteLength(html) <= 63 * 1024, `raw ${Buffer.byteLength(html)}`);
  assert.ok(gzipSync(html).length <= 15.5 * 1024, `gzip ${gzipSync(html).length}`);
  assert.equal((html.match(/data-item/g) || []).length, 60 + archive.items.length, 'every story is still there');
  assert.ok(!html.includes(heavy.find((i) => i.excerpt.length > 200).excerpt), 'long excerpts were shortened');
  // A normal day keeps its excerpts whole.
  assert.ok(render().includes('Excerpt 1.'));
  assert.equal(CAPTIONS.idle, 'The slot glows when something new arrives.');
});
