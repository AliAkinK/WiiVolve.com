// End-to-end: run scripts/build-news.mjs --offline against fixtures in a temp directory.
// Assertions use only the data contracts and the section 6.1 hooks, so they hold for any renderer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { itemId } from '../scripts/lib/util.mjs';
import { resolveSite, parseArgs } from '../scripts/build-news.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FIX = path.join(HERE, 'fixtures');
// The tests own their inputs: a frozen copy of the launch feeds.json next to the saved feeds, so editing
// the real feeds.json (removing a source, changing keywords) never breaks the CI test gate.
const CONFIG = path.join(FIX, 'feeds.json');
const BUILD = path.join(ROOT, 'scripts', 'build-news.mjs');
const NOW1 = '2026-11-04T17:00:00Z';

const EXTRA_SOURCES = [
  { id: 'edge-hostile', name: 'Edge <Hostile> & "Co"', tab: 'scene', filter: 'none', priority: 1, url: 'https://hostile.example/feed.xml', homepage: 'https://hostile.example/', fixture: 'edge-hostile.xml' },
  { id: 'edge-aggregator', name: 'Edge Aggregator', tab: 'press', filter: 'keywords', aggregator: true, priority: 0, url: 'https://news.aggregator.example/rss', homepage: 'https://news.aggregator.example/', fixture: 'edge-aggregator.xml' },
  { id: 'edge-dates', name: 'Edge Dates', tab: 'scene', filter: 'none', priority: 1, maxItems: 20, url: 'https://edge.example/dates.xml', homepage: 'https://edge.example/', fixture: 'edge-dates.xml' },
  { id: 'edge-notfeed', name: 'Edge Not A Feed', tab: 'press', filter: 'keywords', priority: 1, url: 'https://gonintendo.example/feeds', homepage: 'https://gonintendo.example/', fixture: 'edge-html-page.xml' },
];

const ARCHIVE = {
  version: 1,
  items: [
    { id: 'wv-267', title: 'WiiVolve Reconstruction Plan', url: 'https://web.archive.org/web/20110509/http://wiivolve.com/fullNews.php?newsId=267', source: 'WiiVolve', sourceId: 'wiivolve', tab: 'archive', kind: 'post', published: '2008-03-01T13:12:00Z', firstSeen: '2008-03-01T13:12:00Z', excerpt: 'WiiVolve will be undergoing a change.', matched: [] },
    { id: 'wv-0', title: 'NEW SITE COMING SOON', url: 'https://web.archive.org/web/20060826001626/http://wiivolve.com/', source: 'WiiVolve', sourceId: 'wiivolve', tab: 'archive', kind: 'milestone', note: 'Where it all started', published: '2006-08-26T00:16:26Z', firstSeen: '2006-08-26T00:16:26Z', excerpt: '', matched: [] },
  ],
};

const temps = [];
after(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

async function setup({ without = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-build-'));
  temps.push(dir);
  const ctx = { dir, fixtures: path.join(dir, 'fixtures'), site: path.join(dir, 'site'), state: path.join(dir, 'state', 'state.json'), configPath: path.join(dir, 'feeds.json'), runs: 0 };
  await mkdir(ctx.fixtures, { recursive: true });
  await mkdir(ctx.site, { recursive: true });
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  ctx.missing = [];
  for (const s of config.sources) {
    if (existsSync(path.join(FIX, `${s.id}.xml`))) await copyFile(path.join(FIX, `${s.id}.xml`), path.join(ctx.fixtures, `${s.id}.xml`));
    else ctx.missing.push(s.id);
  }
  for (const { fixture, ...s } of EXTRA_SOURCES.filter((e) => !without.includes(e.id))) {
    await copyFile(path.join(FIX, fixture), path.join(ctx.fixtures, `${s.id}.xml`));
    config.sources.push(s);
  }
  ctx.config = config;
  await writeFile(ctx.configPath, JSON.stringify(config, null, 2));
  await writeFile(path.join(ctx.site, 'archive.json'), JSON.stringify(ARCHIVE, null, 2));
  return ctx;
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GITHUB_')) delete env[k];
  return env;
}

function run(ctx, now, args = ['--quiet'], { fixtures = ctx.fixtures } = {}) {
  ctx.runs++;
  const ghOut = path.join(ctx.dir, `github-output-${ctx.runs}`);
  const ghSum = path.join(ctx.dir, `github-summary-${ctx.runs}`);
  const r = spawnSync(
    process.execPath,
    [BUILD, '--offline', '--fixtures', fixtures, '--out', ctx.site, '--state', ctx.state, '--config', ctx.configPath, '--now', now, ...args],
    { env: { ...cleanEnv(), GITHUB_OUTPUT: ghOut, GITHUB_STEP_SUMMARY: ghSum }, encoding: 'utf8' },
  );
  const lines = existsSync(ghOut) ? readFileSync(ghOut, 'utf8').split('\n').filter(Boolean) : [];
  const gh = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, changed: gh.changed, summary: gh.summary, stepSummary: existsSync(ghSum) ? readFileSync(ghSum, 'utf8') : '' };
}

const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const out = (ctx, f) => path.join(ctx.site, f);
const OUTPUTS = ['index.html', 'news.json', 'feed.xml', 'feed.json', 'health.json'];
const snapshot = async (ctx) => Object.fromEntries(await Promise.all(OUTPUTS.map(async (f) => [f, { text: await readFile(out(ctx, f), 'utf8'), mtime: (await stat(out(ctx, f))).mtimeMs }])));

let ctx;

test('first run writes every output, follows the launch-day firstSeen rule and normalizes items', async () => {
  ctx = await setup();
  const r = run(ctx, NOW1, []);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.changed, 'true');
  assert.match(r.summary, /items \(press \d+, scene \d+\)/);
  assert.match(r.stdout, /^ok\s+nintendolife\s+200\s+-\s+12 parsed\s+0 kept\s+0 shown$/m, 'one log line per source (no timing offline)');
  assert.match(r.stdout, /^stale\s+edge-notfeed\s+200\s+.*not a feed/m);
  assert.match(r.stepSummary, /\| Source \| Status \| HTTP \| ms \| Parsed \| Kept \| Shown \| Note \|/);
  assert.match(r.stepSummary, /\| Edge <Hostile> & "Co" \| ok \|/);
  for (const f of OUTPUTS) assert.ok(existsSync(out(ctx, f)), f);
  assert.ok(existsSync(ctx.state));

  const news = await readJson(out(ctx, 'news.json'));
  assert.equal(news.version, 1);
  assert.equal(news.generatedAt, NOW1);
  assert.ok(news.items.length >= 20, `items: ${news.items.length}`);
  const keys = ['id', 'title', 'url', 'source', 'sourceId', 'tab', 'published', 'firstSeen', 'excerpt', 'matched'];
  for (const it of news.items) {
    assert.deepEqual(Object.keys(it).filter((k) => k !== 'via'), keys);
    assert.match(it.id, /^[0-9a-f]{12}$/);
    assert.equal(it.id, itemId(it.url));
    assert.match(it.url, /^https?:\/\//);
    assert.ok(['press', 'scene'].includes(it.tab));
    assert.match(it.published, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(it.firstSeen, it.published, `launch day: firstSeen = published (${it.title})`);
    assert.ok(it.published <= NOW1, 'never in the future');
    assert.ok(it.title.length <= 200 && it.excerpt.length <= 220);
    assert.ok(!/megathread|memery monday|what are wii playing wednesday/i.test(it.title), it.title);
  }
  const sorted = [...news.items].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
  assert.deepEqual(news.items.map((i) => i.published), sorted.map((i) => i.published));
  assert.deepEqual(news.meta.counts, { press: news.items.filter((i) => i.tab === 'press').length, scene: news.items.filter((i) => i.tab === 'scene').length });
  assert.equal(news.meta.dolphin.version, '2609');
  assert.equal(news.meta.dolphin.url, 'https://dolphin-emu.org/blog/2026/09/24/dolphin-progress-report-release-2609/');
  // The window and where each view's list is complete (D9): never before the window start.
  assert.equal(news.meta.windowStart, new Date(Date.parse(NOW1) - 14 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  for (const v of ['all', 'press', 'scene']) assert.ok(news.meta.completeSince[v] >= news.meta.windowStart, v);
  const page = await readFile(out(ctx, 'index.html'), 'utf8');
  assert.match(page, new RegExp(`<div class="stream wrap" id="stream" data-window="${news.meta.windowStart}">`));
  if (news.items.some((i) => i.published < news.meta.windowStart)) assert.equal((page.match(/class="further"/g) || []).length, 1);

  const byTitle = (t) => news.items.filter((i) => i.title === t);
  // Aggregator normalization and dedupe.
  for (const it of news.items.filter((i) => i.via)) {
    assert.ok(!/^www\./.test(it.source), it.source);
    assert.ok(!it.title.endsWith(` - ${it.source}`), it.title);
    assert.equal(it.excerpt, '');
  }
  assert.deepEqual(byTitle('Trying to find every mecha games on Wii').map((i) => i.sourceId), ['reddit-wii'], 'the publisher copy beats the aggregator copy');
  assert.equal(byTitle('The Wii turns 20 this month')[0].source, 'example-news.com');
  assert.equal(byTitle('The Wii turns 20 this month')[0].via, 'Edge Aggregator');
  assert.equal(byTitle('Wii Sports bowling league returns')[0].source, 'No Source Element');
  assert.equal(byTitle('Wii headline with a hostile publisher')[0].source, 'Evil Publisher');
  assert.ok(!news.items.some((i) => /Wii U|Switch 2 sales/.test(i.title)), 'Wii U and off-topic aggregator items dropped');
  assert.ok(news.items.some((i) => i.sourceId === 'googlenews' && i.source === 'SVG' && i.via === 'Google News'));
  // Unconditional vs keyword sources.
  for (const it of news.items) {
    const src = ctx.config.sources.find((s) => s.id === it.sourceId);
    if (src.filter === 'none') assert.deepEqual(it.matched, []);
    else assert.ok(it.matched.length > 0, it.title);
  }

  // Dates: missing, invalid, far-future, impossible and epoch dates fall back to firstSeen (= now on first sight).
  const byPath = Object.fromEntries(news.items.filter((i) => i.sourceId === 'edge-dates').map((i) => [new URL(i.url).pathname.split('/').pop(), i.published]));
  assert.deepEqual(byPath, {
    missing: NOW1, invalid: NOW1, future: NOW1, soon: NOW1, impossible: NOW1, epoch: NOW1,
    pst: '2026-11-03T20:00:00Z', iso: '2026-11-03T04:45:30Z', isonozone: '2026-11-02T08:00:00Z', dateonly: '2026-11-01T00:00:00Z',
    twodigit: '2026-11-01T09:00:00Z', dc: '2026-10-31T09:00:00Z', updated: '2026-10-30T06:00:00Z',
  });

  // Hostile input: non-http(s) links drop the item, relative links resolve against the feed URL.
  const hostile = news.items.filter((i) => i.sourceId === 'edge-hostile');
  assert.equal(hostile.length, 3);
  assert.ok(hostile.some((i) => i.url === 'https://hostile.example/relative/wii'));
  assert.ok(hostile.every((i) => i.source === 'Edge <Hostile> & "Co"'));
  const evil = hostile.find((i) => i.title.startsWith('<script>'));
  assert.equal(evil.title, '<script>alert(1)</script> Wii exploit headline', 'kept as text, escaped on output');
  assert.equal(evil.excerpt, 'Excerpt with <script>alert(3)</script> text and inline on the Wii', 'real <script> elements removed, escaped text kept');

  const health = await readJson(out(ctx, 'health.json'));
  assert.equal(health.version, 1);
  assert.equal(health.generatedAt, NOW1);
  assert.equal(health.sources.length, ctx.config.sources.length);
  const hs = Object.fromEntries(health.sources.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(hs.nintendolife), ['id', 'name', 'tab', 'homepage', 'status', 'lastOk', 'failures', 'items', 'httpStatus', 'error', 'ms']);
  assert.equal(hs.nintendolife.status, 'ok');
  assert.equal(hs.nintendolife.lastOk, NOW1);
  assert.equal(hs.nintendolife.httpStatus, 200);
  assert.equal(hs['edge-notfeed'].status, 'stale');
  assert.match(hs['edge-notfeed'].error, /not a feed/);
  assert.equal(hs['edge-notfeed'].lastOk, null);
  for (const id of ctx.missing) assert.equal(hs[id].error, 'fixture missing');
  for (const s of health.sources) assert.equal(s.items, news.items.filter((i) => i.sourceId === s.id).length, s.id);
  const okNow = health.sources.filter((s) => s.status === 'ok').length;
  assert.ok(okNow < ctx.config.sources.length);
  assert.deepEqual(health.summary, { ok: okNow, total: ctx.config.sources.length }, 'only a source whose latest fetch worked is OK; a stale one is "Retrying"');

  const rss = parseFeed(await readFile(out(ctx, 'feed.xml'), 'utf8'));
  assert.equal(rss.format, 'rss');
  assert.deepEqual(rss.items.map((i) => i.guid), news.items.map((i) => i.id));
  assert.deepEqual(rss.items.map((i) => i.title), news.items.map((i) => i.title));
  const jf = await readJson(out(ctx, 'feed.json'));
  assert.equal(jf.version, 'https://jsonfeed.org/version/1.1');
  assert.deepEqual(jf.items.map((i) => i.id), news.items.map((i) => i.id));

  const html = await readFile(out(ctx, 'index.html'), 'utf8');
  for (const it of [...news.items, ...ARCHIVE.items]) assert.ok(html.includes(`data-id="${it.id}"`), it.id);
  for (const hook of ['main', 'console', 'stream', 'deep-end', 'archive', 'search', 'about', 'status']) assert.match(html, new RegExp(`\\sid="${hook}"`), hook);

  const state = await readJson(ctx.state);
  assert.equal(state.version, 1);
  assert.match(state.signature, /^[0-9a-f]{64}$/);
  assert.equal(state.lastWrite, NOW1);
  for (const it of news.items) assert.equal(state.seen[it.id], it.firstSeen);
  for (const [id, mem] of Object.entries(state.sources)) {
    assert.ok(mem.items.length <= 50, id);
    assert.deepEqual(Object.keys(mem), ['etag', 'lastModified', 'lastOk', 'lastAttempt', 'failures', 'httpStatus', 'error', 'items']);
  }
  assert.equal(state.sources['edge-notfeed'].failures, 1);
});

test('XSS canaries: hostile titles, excerpts and names are escaped; javascript: and data: links never appear', async () => {
  const html = await readFile(out(ctx, 'index.html'), 'utf8');
  const xml = await readFile(out(ctx, 'feed.xml'), 'utf8');
  for (const [name, text] of [['index.html', html], ['feed.xml', xml]]) {
    assert.ok(!text.includes('<script>alert'), `${name}: raw <script>`);
    assert.ok(!/<svg[\s/]/i.test(text), `${name}: raw <svg>`);
    assert.ok(!/<img src=x/i.test(text), `${name}: raw <img>`);
    assert.ok(!/<b onmouseover/i.test(text), `${name}: raw <b onmouseover>`);
    assert.ok(!/javascript:/i.test(text), `${name}: javascript: URL`);
    assert.ok(!/data:text\/html/i.test(text), `${name}: data: URL`);
    assert.ok(!text.includes('Edge <Hostile>'), `${name}: raw source name`);
    assert.ok(!text.includes('</textarea><img'), `${name}: raw excerpt markup`);
  }
  assert.ok(html.includes('alert(1)') && html.includes('alert(3)'), 'the hostile text is shown (escaped), not silently lost');
  const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
  assert.ok(!tags.some((t) => /\son[a-z]+\s*=/i.test(t)), 'no on*= attributes at all');
  for (const f of ['news.json', 'feed.json']) assert.ok(!/javascript:|data:text/i.test(await readFile(out(ctx, f), 'utf8')), f);
});

test('a failing source changes the signature at each of its first three failures; then identical runs report changed=false and write nothing but the state', async () => {
  // edge-notfeed (an HTML page, not a feed) fails on every run: stale 1 (run 1), stale 2, then down.
  assert.equal(run(ctx, NOW1).changed, 'true', 'second failure');
  assert.equal(run(ctx, NOW1).changed, 'true', 'third failure: down');
  assert.equal((await readJson(out(ctx, 'health.json'))).sources.find((s) => s.id === 'edge-notfeed').status, 'down');
  const before = await snapshot(ctx);
  const stateBefore = await readJson(ctx.state);
  const r = run(ctx, NOW1);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', '--quiet prints nothing');
  assert.equal(r.changed, 'false', 'the failure count is capped at 3 in the signature');
  assert.match(r.summary, /unchanged/);
  const afterSnap = await snapshot(ctx);
  for (const f of OUTPUTS) {
    assert.equal(afterSnap[f].text, before[f].text, f);
    assert.equal(afterSnap[f].mtime, before[f].mtime, `${f} not rewritten`);
  }
  const state = await readJson(ctx.state);
  assert.equal(state.signature, stateBefore.signature);
  assert.equal(state.lastWrite, NOW1);
  assert.equal(state.sources['edge-notfeed'].failures, 4, 'source memory is still updated');
});

test('--force rewrites the outputs even when nothing changed', async () => {
  const before = await snapshot(ctx);
  const r = run(ctx, NOW1, ['--quiet', '--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.changed, 'true');
  const afterSnap = await snapshot(ctx);
  for (const f of ['news.json', 'feed.xml', 'feed.json']) {
    assert.equal(afterSnap[f].text, before[f].text, `${f}: same inputs, same bytes`);
    assert.notEqual(afterSnap[f].mtime, before[f].mtime, `${f} rewritten`);
  }
});

test('deterministic: two fresh builds from the same inputs are byte-identical', async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(run(a, NOW1).status, 0);
  assert.equal(run(b, NOW1).status, 0);
  for (const f of OUTPUTS) assert.equal(await readFile(out(a, f), 'utf8'), await readFile(out(b, f), 'utf8'), f);
  const sa = await readJson(a.state);
  const sb = await readJson(b.state);
  assert.deepEqual(sa, sb);
});

test('accumulation: items that left the feed stay; firstSeen follows the 48-hour rule after launch', async () => {
  const before = await readJson(out(ctx, 'news.json'));
  const lucia = before.items.find((i) => /Lucía/.test(i.title));
  assert.ok(lucia, 'fixture item present on launch day');
  const file = path.join(ctx.fixtures, 'reddit-wii.xml');
  let xml = await readFile(file, 'utf8');
  xml = xml.replace(/<entry>(?:(?!<\/entry>)[\s\S])*?Lucía(?:(?!<\/entry>)[\s\S])*?<\/entry>/, '');
  assert.ok(!xml.includes('Lucía'));
  const entry = (slug, title, published) =>
    `<entry><author><name>/u/test</name></author><category term="wii" label="r/wii"/><content type="html">&lt;p&gt;${title} body&lt;/p&gt;</content><id>t3_${slug}</id><link href="https://www.reddit.com/r/wii/comments/${slug}/x/" /><updated>${published}</updated><published>${published}</published><title>${title}</title></entry>`;
  xml = xml.replace('</feed>', `${entry('new1', 'Brand new Wii post', '2026-11-04T17:40:00+00:00')}${entry('late1', 'Late Wii post from last week', '2026-10-30T12:00:00+00:00')}</feed>`);
  await writeFile(file, xml);

  const NOW2 = '2026-11-04T18:00:00Z';
  const r = run(ctx, NOW2);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.changed, 'true');
  const news = await readJson(out(ctx, 'news.json'));
  const kept = news.items.find((i) => i.id === lucia.id);
  assert.ok(kept, 'an item that left its feed is still listed');
  assert.equal(kept.firstSeen, lucia.firstSeen);
  const fresh = news.items.find((i) => i.title === 'Brand new Wii post');
  assert.equal(fresh.published, '2026-11-04T17:40:00Z');
  assert.equal(fresh.firstSeen, NOW2, 'new and recent: firstSeen = now');
  const state = await readJson(ctx.state);
  const lateId = itemId('https://www.reddit.com/r/wii/comments/late1/x/');
  assert.equal(state.seen[lateId], '2026-10-30T12:00:00Z', 'discovered late (older than 48 h): firstSeen = published');
  for (const it of before.items) if (news.items.some((n) => n.id === it.id)) assert.equal(news.items.find((n) => n.id === it.id).firstSeen, it.firstSeen, it.title);
});

test('a failing source keeps its cached items as "stale" and becomes "down" after 3 consecutive failures', async () => {
  const file = path.join(ctx.fixtures, 'reddit-wii.xml');
  const saved = await readFile(file);
  await rm(file);
  const shownBefore = (await readJson(out(ctx, 'news.json'))).items.filter((i) => i.sourceId === 'reddit-wii').map((i) => i.id);
  assert.ok(shownBefore.length > 0);

  const r1 = run(ctx, '2026-11-04T19:00:00Z');
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.changed, 'true', 'each failure step changes the signature, so CI keeps the count');
  assert.match(r1.stepSummary, /\| r\/wii \| stale \| - \|/);
  let state = await readJson(ctx.state);
  assert.equal(state.sources['reddit-wii'].failures, 1);
  assert.equal(state.sources['reddit-wii'].error, 'fixture missing');
  assert.equal(state.sources['reddit-wii'].lastOk, '2026-11-04T18:00:00Z');
  assert.ok(state.sources['reddit-wii'].items.length > 0, 'cached items kept');
  const stale = (await readJson(out(ctx, 'health.json'))).sources.find((s) => s.id === 'reddit-wii');
  assert.deepEqual([stale.status, stale.failures], ['stale', 1], 'the page says "Retrying" from the first failure');

  const r2 = run(ctx, '2026-11-04T20:00:00Z');
  assert.equal(r2.changed, 'true');
  state = await readJson(ctx.state);
  assert.equal(state.sources['reddit-wii'].failures, 2);

  const r3 = run(ctx, '2026-11-04T21:00:00Z');
  assert.equal(r3.changed, 'true', 'going down changes the signature');
  const health = await readJson(out(ctx, 'health.json'));
  const h = health.sources.find((s) => s.id === 'reddit-wii');
  assert.equal(h.status, 'down');
  assert.equal(h.failures, 3);
  assert.equal(h.lastOk, '2026-11-04T18:00:00Z');
  assert.equal(h.httpStatus, null);
  assert.equal(h.error, 'fixture missing');
  assert.ok(h.items > 0, 'its cached items are still shown');
  const news = await readJson(out(ctx, 'news.json'));
  assert.deepEqual(news.items.filter((i) => i.sourceId === 'reddit-wii').map((i) => i.id), shownBefore);
  const down = health.sources.filter((s) => s.status === 'down').length;
  assert.equal(health.summary.ok, health.summary.total - down);

  await writeFile(file, saved);
  const r4 = run(ctx, '2026-11-04T22:00:00Z');
  assert.equal(r4.changed, 'true', 'recovery changes the signature');
  const healed = (await readJson(out(ctx, 'health.json'))).sources.find((s) => s.id === 'reddit-wii');
  assert.equal(healed.status, 'ok');
  assert.equal(healed.failures, 0);
  assert.equal(healed.error, null);
});

test('the UTC day and the archive are part of the change signature', async () => {
  assert.equal(run(ctx, '2026-11-04T23:00:00Z').changed, 'false');
  assert.equal(run(ctx, '2026-11-05T00:30:00Z').changed, 'true', 'a new UTC day always changes');
  assert.equal(run(ctx, '2026-11-05T01:00:00Z').changed, 'false');
  const archive = structuredClone(ARCHIVE);
  archive.items[0].excerpt = 'Edited by hand.';
  await writeFile(path.join(ctx.site, 'archive.json'), JSON.stringify(archive, null, 2));
  assert.equal(run(ctx, '2026-11-05T01:30:00Z').changed, 'true', 'an archive edit changes');
  assert.equal(run(ctx, '2026-11-05T02:00:00Z').changed, 'false');
});

test('when every source fails, the previous items stay and the health line can say so', async () => {
  const c = await setup();
  assert.equal(run(c, NOW1).changed, 'true');
  const before = await readJson(out(c, 'news.json'));
  const empty = path.join(c.dir, 'no-fixtures');
  await mkdir(empty);
  assert.equal(run(c, '2026-11-04T17:10:00Z', ['--quiet'], { fixtures: empty }).changed, 'true', 'every source goes stale');
  run(c, '2026-11-04T17:20:00Z', ['--quiet'], { fixtures: empty });
  const r = run(c, '2026-11-04T17:30:00Z', ['--quiet'], { fixtures: empty });
  assert.equal(r.status, 0);
  assert.equal(r.changed, 'true');
  const news = await readJson(out(c, 'news.json'));
  assert.deepEqual(news.items.map((i) => i.id), before.items.map((i) => i.id));
  const health = await readJson(out(c, 'health.json'));
  assert.equal(health.summary.ok, 0);
  assert.ok(health.sources.every((s) => s.status === 'down'));
});

test('CI replay: every run starts from the last changed run, as on GitHub; a source failing every hour is "down" on the third run', async () => {
  // CI commits site/ and state/ only when the build reports changed=true; the runner throws the rest away.
  const c = await setup({ without: ['edge-notfeed'] });
  const files = [...OUTPUTS.map((f) => out(c, f)), c.state];
  let committed = null;
  const ci = async (now) => {
    if (committed) for (const [f, text] of committed) await writeFile(f, text);
    const r = run(c, now);
    assert.equal(r.status, 0, r.stderr);
    if (r.changed === 'true') committed = await Promise.all(files.map(async (f) => [f, await readFile(f, 'utf8')]));
    const live = JSON.parse(committed.find(([f]) => f.endsWith('health.json'))[1]);
    return { changed: r.changed, wii: live.sources.find((s) => s.id === 'reddit-wii') };
  };
  // 17:47 UTC: the edge-dates "thirty minutes ahead" item (17:30) is no longer in the future.
  assert.equal((await ci('2026-11-04T17:47:00Z')).changed, 'true', 'first run');
  assert.equal((await ci('2026-11-04T18:47:00Z')).changed, 'false', 'an hour later with the same feeds: nothing to commit or deploy');

  const file = path.join(c.fixtures, 'reddit-wii.xml');
  const saved = await readFile(file);
  await rm(file);
  const h1 = await ci('2026-11-04T19:47:00Z');
  assert.deepEqual([h1.changed, h1.wii.status, h1.wii.failures], ['true', 'stale', 1]);
  const h2 = await ci('2026-11-04T20:47:00Z');
  assert.deepEqual([h2.changed, h2.wii.status, h2.wii.failures], ['true', 'stale', 2]);
  const h3 = await ci('2026-11-04T21:47:00Z');
  assert.deepEqual([h3.changed, h3.wii.status, h3.wii.failures], ['true', 'down', 3], 'down on the third failing hour, as the contract says');
  const h4 = await ci('2026-11-04T22:47:00Z');
  assert.deepEqual([h4.changed, h4.wii.status], ['false', 'down'], 'staying down changes nothing');
  await writeFile(file, saved);
  const h5 = await ci('2026-11-04T23:47:00Z');
  assert.deepEqual([h5.changed, h5.wii.status, h5.wii.failures], ['true', 'ok', 0], 'recovery is one changed run');
  assert.equal((await ci('2026-11-05T00:47:00Z')).changed, 'true', 'the UTC day still changes once a day');
  assert.equal((await ci('2026-11-05T01:47:00Z')).changed, 'false');
});

test('CLI: usage errors exit 2, --help exits 0', () => {
  const bogus = spawnSync(process.execPath, [BUILD, '--bogus'], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /unknown option/);
  const badNow = spawnSync(process.execPath, [BUILD, '--offline', '--now', 'yesterday-ish', '--out', path.join(temps[0], 'x')], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(badNow.status, 2);
  assert.match(badNow.stderr, /--now/);
  const help = spawnSync(process.execPath, [BUILD, '--help'], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  assert.deepEqual(parseArgs(['--now=2026-11-04T17:00:00Z', '--force', '--out', 'x']).now, '2026-11-04T17:00:00Z');
});

test('site.repo resolution: config, else GITHUB_SERVER_URL + GITHUB_REPOSITORY, else null', () => {
  const site = { url: 'https://wiivolve.com/', repo: null };
  assert.equal(resolveSite(site, {}).repo, null);
  assert.equal(resolveSite(site, {}).url, 'https://wiivolve.com');
  assert.equal(resolveSite(site, { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'ali/wiivolve' }).repo, 'https://github.com/ali/wiivolve');
  assert.equal(resolveSite(site, { GITHUB_REPOSITORY: 'ali/wiivolve' }).repo, 'https://github.com/ali/wiivolve');
  assert.equal(resolveSite({ ...site, repo: 'https://github.com/owner/repo/' }, { GITHUB_REPOSITORY: 'x/y' }).repo, 'https://github.com/owner/repo');
  assert.equal(resolveSite({ ...site, repo: 'javascript:alert(1)' }, {}).repo, null);
});
