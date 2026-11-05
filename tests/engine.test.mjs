// The builder end to end with a fake network (runBuild's fetchImpl): conditional requests, rules changes,
// caps, the change signature, memory pruning and the fetch defaults. Written after a mutation run showed these
// paths could break without any test failing (engine-6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild, rulesHashOf, ENGINE_VERSION } from '../scripts/build-news.mjs';
import { fetchFeed, decodeBody, TIMEOUT_MS, RETRY_DELAY_MS, HOST_GAP_MS, MAX_BYTES } from '../scripts/lib/fetch.mjs';
import { itemId } from '../scripts/lib/util.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
after(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

const rss = (items) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description ?? ''}</description><pubDate>${new Date(i.date).toUTCString()}</pubDate></item>`)
    .join('')}</channel></rss>`;

const BASE = {
  site: { url: 'https://wiivolve.com', name: 'WiiVolve', tagline: 'Still spinning since 2006.', description: 'd', author: 'Ali Kurnaz', since: 2006, wiiLaunch: '2006-11-19', repo: null },
  selection: { windowDays: 14, minItems: 30, maxAgeDays: 400, maxItems: 60, maxPerSource: 12 },
  wiiU: false,
  keywords: ['Wii', 'Nunchuk', 'Wii Sports'],
  exclude: ['megathread'],
  userAgent: 'WiiVolveTest/1.0',
};

/** A temp project: feeds.json from `config`, the real template and archive; feeds served by a fake fetch. */
async function project(config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-engine-'));
  temps.push(dir);
  const site = path.join(dir, 'site');
  await mkdir(site, { recursive: true });
  await copyFile(path.join(ROOT, 'site', 'archive.json'), path.join(site, 'archive.json'));
  const p = { dir, site, state: path.join(dir, 'state.json'), configPath: path.join(dir, 'feeds.json'), feeds: new Map(), calls: [] };
  p.setConfig = (c) => writeFile(p.configPath, JSON.stringify(c));
  await p.setConfig(config);
  // feeds: url -> { body, etag, lastModified, status, finalUrl }
  p.fetchImpl = async (url, init) => {
    p.calls.push({ url, headers: { ...init.headers }, signal: init.signal });
    const f = p.feeds.get(url);
    if (!f) return new Response('', { status: 404 });
    if (f.etag && init.headers['If-None-Match'] === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
    if (f.lastModified && init.headers['If-Modified-Since'] === f.lastModified) return new Response(null, { status: 304 });
    const headers = { 'content-type': 'application/rss+xml; charset=utf-8' };
    if (f.etag) headers.etag = f.etag;
    if (f.lastModified) headers['last-modified'] = f.lastModified;
    const res = new Response(f.body, { status: f.status ?? 200, headers });
    if (f.finalUrl) Object.defineProperty(res, 'url', { value: f.finalUrl });
    return res;
  };
  p.build = (now, extra = {}) =>
    runBuild({ quiet: true, env: {}, out: site, state: p.state, config: p.configPath, now, fetchImpl: p.fetchImpl, hostGapMs: 0, retryDelayMs: 0, ...extra });
  p.news = async () => JSON.parse(await readFile(path.join(site, 'news.json'), 'utf8'));
  p.stateJson = async () => JSON.parse(await readFile(p.state, 'utf8'));
  return p;
}

const source = (id, extra = {}) => ({ id, name: id, tab: 'press', filter: 'keywords', priority: 2, url: `https://${id}.example/feed`, homepage: `https://${id}.example/`, ...extra });
const NOW = '2026-11-04T17:00:00Z';
const ago = (h) => new Date(Date.parse(NOW) - h * 3600e3).toISOString();

test('a 304 reuses the cached items, keeps the source OK and round-trips ETag and Last-Modified', async () => {
  const p = await project({ ...BASE, sources: [source('alpha'), source('beta')] });
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii one', link: 'https://alpha.example/1', date: ago(2) }]), etag: '"a1"' });
  p.feeds.set('https://beta.example/feed', { body: rss([{ title: 'Wii two', link: 'https://beta.example/2', date: ago(3) }]), lastModified: 'Wed, 04 Nov 2026 12:00:00 GMT' });
  await p.build(NOW);
  let state = await p.stateJson();
  assert.equal(state.sources.alpha.etag, '"a1"');
  assert.equal(state.sources.beta.lastModified, 'Wed, 04 Nov 2026 12:00:00 GMT');
  p.calls.length = 0;
  const r = await p.build('2026-11-04T18:00:00Z');
  const sent = Object.fromEntries(p.calls.map((c) => [new URL(c.url).hostname.split('.')[0], c.headers]));
  assert.equal(sent.alpha['If-None-Match'], '"a1"');
  assert.equal(sent.beta['If-Modified-Since'], 'Wed, 04 Nov 2026 12:00:00 GMT');
  assert.deepEqual(r.sources.map((s) => s.status), ['ok', 'ok'], 'a 304 is a success');
  assert.deepEqual((await p.news()).items.map((i) => i.title).sort(), ['Wii one', 'Wii two'], 'the cached items answer the 304');
  state = await p.stateJson();
  assert.equal(state.sources.alpha.items.length, 1, 'the cached items are kept for the next 304');
  assert.equal(state.sources.alpha.etag, '"a1"');
});

test('a failing source still shows its cached items when the previous page is gone', async () => {
  const p = await project({ ...BASE, sources: [source('alpha')] });
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii cached', link: 'https://alpha.example/c', date: ago(5) }]) });
  await p.build(NOW);
  await rm(path.join(p.site, 'news.json'));
  p.feeds.delete('https://alpha.example/feed');
  await p.build('2026-11-04T18:00:00Z');
  assert.deepEqual((await p.news()).items.map((i) => i.title), ['Wii cached']);
});

test('per-source caps bind and state keeps at most 50 items per source', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ title: `Wii story ${i}`, link: `https://alpha.example/${i}`, date: ago(1 + i) }));
  const p = await project({ ...BASE, sources: [source('alpha'), source('beta', { maxItems: 3 })] });
  p.feeds.set('https://alpha.example/feed', { body: rss(many) });
  p.feeds.set('https://beta.example/feed', { body: rss(many.map((m, i) => ({ ...m, link: `https://beta.example/${i}` }))) });
  await p.build(NOW);
  const news = await p.news();
  assert.equal(news.items.filter((i) => i.sourceId === 'alpha').length, 12, 'maxPerSource');
  assert.equal(news.items.filter((i) => i.sourceId === 'beta').length, 3, 'a source maxItems');
  assert.equal((await p.stateJson()).sources.alpha.items.length, 50);
});

test('the change signature covers excerpts and URLs', async () => {
  const p = await project({ ...BASE, sources: [source('alpha', { filter: 'none' })] });
  const item = { title: 'Wii item', link: 'https://alpha.example/a', description: 'First excerpt.', date: ago(2) };
  p.feeds.set('https://alpha.example/feed', { body: rss([item]) });
  await p.build(NOW);
  assert.equal((await p.build('2026-11-04T17:10:00Z')).changed, false);
  p.feeds.set('https://alpha.example/feed', { body: rss([{ ...item, description: 'Edited excerpt.' }]) });
  assert.equal((await p.build('2026-11-04T17:20:00Z')).changed, true, 'an edited excerpt');
  p.feeds.set('https://alpha.example/feed', { body: rss([{ ...item, description: 'Edited excerpt.', link: 'https://alpha.example/a?x=1' }]) });
  assert.equal((await p.build('2026-11-04T17:30:00Z')).changed, true, 'a new URL');
});

test('memory: seen ids are pruned after 45 days without a sighting, kept before', async () => {
  const p = await project({ ...BASE, sources: [source('alpha', { filter: 'none' })] });
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii now', link: 'https://alpha.example/n', date: ago(1) }]) });
  await p.build(NOW);
  const state = await p.stateJson();
  state.seen = { aaaaaaaaaaaa: new Date(Date.parse(NOW) - 44 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z'), bbbbbbbbbbbb: new Date(Date.parse(NOW) - 46 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z') };
  await writeFile(p.state, JSON.stringify(state));
  await p.build('2026-11-04T17:10:00Z');
  const seen = (await p.stateJson()).seen;
  assert.ok('aaaaaaaaaaaa' in seen, '44 days: kept');
  assert.ok(!('bbbbbbbbbbbb' in seen), '46 days: pruned');
  assert.ok(itemId('https://alpha.example/n') in seen);
});

test('same-host sources take turns going first, by UTC hour', async () => {
  const p = await project({ ...BASE, sources: [source('r1', { url: 'https://www.reddit.example/r/a/.rss' }), source('r2', { url: 'https://www.reddit.example/r/b/.rss' })] });
  const order = async (now) => {
    p.calls.length = 0;
    await p.build(now);
    return p.calls.map((c) => c.url.split('/')[4]);
  };
  const a = await order('2026-11-04T16:00:00Z');
  const b = await order('2026-11-04T17:00:00Z');
  assert.deepEqual([a, b], [['a', 'b'], ['b', 'a']]);
});

test('a rules change refetches without validators and re-checks the stories already shown (engine-3)', async () => {
  const p = await project({ ...BASE, wiiU: true, sources: [source('alpha')] });
  const wiiu = { title: 'Wii U eShop gets one last surprise update', link: 'https://alpha.example/u', date: ago(3) };
  const nunchuk = { title: 'Robot arm upgrade', link: 'https://alpha.example/n', description: 'A Nunchuk here and a second Nunchuk there.', date: ago(4) };
  const vc = { title: 'Virtual Console memories', link: 'https://alpha.example/v', date: ago(5) };
  p.feeds.set('https://alpha.example/feed', { body: rss([wiiu, nunchuk, vc]), etag: '"v1"' });
  await p.build(NOW);
  assert.deepEqual((await p.news()).items.map((i) => i.title).sort(), ['Robot arm upgrade', 'Wii U eShop gets one last surprise update']);

  // Same rules: a 304. New rules: no validators, so the feed answers in full and the new keyword is seen.
  p.calls.length = 0;
  await p.build('2026-11-04T17:10:00Z');
  assert.equal(p.calls[0].headers['If-None-Match'], '"v1"');
  await p.setConfig({ ...BASE, wiiU: false, keywords: [...BASE.keywords.filter((k) => k !== 'Nunchuk'), 'Virtual Console'], sources: [source('alpha')] });
  p.calls.length = 0;
  const r = await p.build('2026-11-04T17:20:00Z');
  assert.equal(p.calls[0].headers['If-None-Match'], undefined, 'every feed is fetched in full after a rules change');
  assert.match(r.summary, /filter rules or engine changed: every feed fetched in full, 2 shown stories dropped/);
  assert.deepEqual((await p.news()).items.map((i) => i.title), ['Virtual Console memories'], 'Wii U (wiiU now false) and the Nunchuk-only story leave; the new keyword lands');

  // A story no longer in its feed: dropped when its title fails and its matched keywords are gone.
  p.feeds.set('https://alpha.example/feed', { body: rss([]), etag: '"v2"' });
  await p.build('2026-11-04T17:30:00Z');
  assert.deepEqual((await p.news()).items.map((i) => i.title), ['Virtual Console memories'], 'accumulated stories stay while the rules stand');
  await p.setConfig({ ...BASE, sources: [source('alpha')] });
  await p.build('2026-11-04T17:40:00Z');
  assert.deepEqual((await p.news()).items, [], 'its keyword removed and its title no longer matching: gone');
});

test('relative links resolve against the feed address after redirects (engine-11)', async () => {
  const p = await project({ ...BASE, sources: [source('alpha', { filter: 'none' })] });
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii relative', link: 'post/1', date: ago(2) }]), finalUrl: 'https://alpha.example/sub/feed.xml' });
  await p.build(NOW);
  assert.equal((await p.news()).items[0].url, 'https://alpha.example/sub/post/1');
});

test('fetch defaults and failure modes: timeout signal, no retry on a redirect loop (engine-6, engine-11)', async () => {
  assert.deepEqual([TIMEOUT_MS, RETRY_DELAY_MS, HOST_GAP_MS, MAX_BYTES], [15000, 2000, 3000, 5 * 1024 * 1024]);
  const src = { id: 'x', url: 'https://x.example/feed' };
  // A fetch that never answers. The ref'd timer keeps Node 22 alive until the (unref'd) timeout signal fires.
  const hang = (url, init) =>
    new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      });
    });
  const r = await fetchFeed(src, { timeoutMs: 30, retryDelayMs: 0, fetchImpl: hang });
  assert.deepEqual([r.ok, r.error, r.attempts], [false, 'timeout', 2]);
  let calls = 0;
  const loop = async () => {
    calls++;
    throw new TypeError('fetch failed', { cause: new Error('redirect count exceeded') });
  };
  const l = await fetchFeed(src, { retryDelayMs: 0, fetchImpl: loop });
  assert.deepEqual([l.ok, calls], [false, 1], 'a redirect loop is not retried');
});

test('windows-1252 bytes labelled UTF-8 are read as cp1252; mostly valid UTF-8 stays UTF-8 (engine-10)', () => {
  const cp = Buffer.from([0x4e, 0x69, 0x6e, 0x74, 0x65, 0x6e, 0x64, 0x6f, 0x92, 0x73, 0x20, 0x63, 0x61, 0x66, 0xe9]);
  assert.deepEqual(decodeBody(cp, 'text/xml; charset=utf-8'), { text: 'Nintendo’s café', charset: 'windows-1252', fallback: true });
  const mostly = Buffer.concat([Buffer.from('Pokémon café ', 'utf8'), Buffer.from([0xe9])]);
  const d = decodeBody(mostly, 'text/xml; charset=utf-8');
  assert.equal(d.charset, 'utf-8');
  assert.equal(d.text, 'Pokémon café �', 'one broken byte is one replacement character, not mojibake');
  assert.equal(decodeBody(Buffer.from('plain ascii'), '').fallback, false);
});

/** CI as it really runs: every build starts from the files the last changed build committed (5.7). */
function ci(p) {
  let committed = null;
  const files = () => [p.state, ...['index.html', 'news.json', 'feed.xml', 'feed.json', 'health.json'].map((f) => path.join(p.site, f))];
  return async (now, extra) => {
    if (committed) for (const [f, text] of committed) if (text === null) await rm(f, { force: true }); else await writeFile(f, text);
    const r = await p.build(now, extra);
    if (r.changed) committed = await Promise.all(files().map(async (f) => [f, await readFile(f, 'utf8').catch(() => null)]));
    return r;
  };
}

test('a rules change made while a keyword source fails sticks: its cache is cleaned too (engine-claims-2)', async () => {
  const cfg = { ...BASE, sources: [source('alpha'), source('beta')] };
  const p = await project(cfg);
  const run = ci(p);
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii one', link: 'https://alpha.example/1', date: ago(2) }]) });
  const robot = { title: 'Robot arm upgrade', link: 'https://beta.example/r', description: 'A Nunchuk here and a second Nunchuk there.', date: ago(3) };
  p.feeds.set('https://beta.example/feed', { body: rss([robot]) });
  const titles = async () => (await p.news()).items.map((i) => i.title).sort();
  await run(NOW);
  assert.deepEqual(await titles(), ['Robot arm upgrade', 'Wii one']);
  p.feeds.set('https://beta.example/feed', { body: '', status: 503 });
  await run('2026-11-04T18:00:00Z');
  // The owner drops "Nunchuk" while beta is still failing: the story leaves at once...
  await p.setConfig({ ...cfg, keywords: BASE.keywords.filter((k) => k !== 'Nunchuk') });
  const r = await run('2026-11-04T19:00:00Z');
  assert.match(r.summary, /1 shown story dropped/);
  assert.deepEqual(await titles(), ['Wii one']);
  // ...and stays gone: the next hour (same rules, beta still failing) and after beta recovers.
  await run('2026-11-04T20:00:00Z');
  assert.deepEqual(await titles(), ['Wii one'], 'not back from the failing source cache');
  assert.deepEqual((await p.stateJson()).sources.beta.items, []);
  p.feeds.set('https://beta.example/feed', { body: rss([robot]) });
  await run('2026-11-04T21:00:00Z');
  assert.deepEqual(await titles(), ['Wii one']);
});

test('rules hash: a no-op keyword edit commits once, then 304s resume; strip, filter and the engine count (engine-claims-3)', async () => {
  const cfg = { ...BASE, sources: [source('alpha')] };
  const p = await project(cfg);
  const run = ci(p);
  p.feeds.set('https://alpha.example/feed', { body: rss([{ title: 'Wii one', link: 'https://alpha.example/1', date: ago(2) }]), etag: '"e1"' });
  await run(NOW);
  await p.setConfig({ ...cfg, keywords: [...BASE.keywords, 'Zapper'] }); // matches nothing on the page
  p.calls.length = 0;
  const edit = await run('2026-11-04T17:20:00Z');
  assert.equal(p.calls[0].headers['If-None-Match'], undefined, 'the edit run fetches in full');
  assert.equal(edit.changed, true, 'the new rules hash is committed even though no story changed');
  p.calls.length = 0;
  assert.equal((await run('2026-11-04T18:20:00Z')).changed, false);
  assert.equal(p.calls[0].headers['If-None-Match'], '"e1"', 'the next hour asks with the ETag again');
  // What the hash covers.
  const h = rulesHashOf(cfg);
  assert.equal(rulesHashOf(structuredClone(cfg)), h, 'stable');
  assert.notEqual(rulesHashOf({ ...cfg, sources: [source('alpha', { strip: ['Read more'] })] }), h, 'a strip pattern');
  assert.notEqual(rulesHashOf({ ...cfg, sources: [source('alpha', { filter: 'none' })] }), h, 'a filter');
  assert.notEqual(rulesHashOf({ ...cfg, exclude: ['help'] }), h, 'an exclusion');
  assert.notEqual(rulesHashOf(cfg, ENGINE_VERSION + 1), h, 'an engine bump');
  assert.equal(rulesHashOf({ ...cfg, selection: { ...cfg.selection, minItems: 5 } }), h, 'selection rules are not filter rules');
});

test('after a rules change, a story its feed still carries goes by the new verdict, even with its keywords configured (engine-claims-3)', async () => {
  const cfg = { ...BASE, sources: [source('alpha')] };
  const p = await project(cfg);
  const robot = { title: 'Robot arm upgrade', link: 'https://alpha.example/r', description: 'A Nunchuk here and a second Nunchuk there.', date: ago(3) };
  p.feeds.set('https://alpha.example/feed', { body: rss([robot, { title: 'Wii one', link: 'https://alpha.example/1', date: ago(4) }]) });
  await p.build(NOW);
  assert.deepEqual((await p.news()).items.find((i) => i.url === robot.link).matched, ['Nunchuk']);
  // The publisher trims the post to one mention, and the owner edits the rules in the same hour: "Nunchuk" is
  // still configured (so the old story's keywords would let it stay), but this run's verdict on it is "drop".
  p.feeds.set('https://alpha.example/feed', { body: rss([{ ...robot, description: 'A Nunchuk here.' }, { title: 'Wii one', link: 'https://alpha.example/1', date: ago(4) }]) });
  await p.setConfig({ ...cfg, keywords: [...BASE.keywords, 'Zapper'] });
  await p.build('2026-11-04T17:10:00Z');
  assert.deepEqual((await p.news()).items.map((i) => i.title), ['Wii one']);
});

test('an empty state file ("start over") with no news.json is a first run: launch-day firstSeen (docs-ops-2)', async () => {
  const p = await project({ ...BASE, sources: [source('alpha', { filter: 'none' })] });
  p.feeds.set('https://alpha.example/feed', { body: rss([1, 2, 3].map((d) => ({ title: `Wii ${d}`, link: `https://alpha.example/${d}`, date: ago(d * 24) }))) });
  await writeFile(p.state, '{}\n');
  const r = await p.build(NOW);
  assert.match(r.summary, /, 0 new;/);
  for (const it of (await p.news()).items) assert.equal(it.firstSeen, it.published, it.title);
  // With news.json kept, "{}" only forgets the memory: today's stories keep their firstSeen.
  await writeFile(p.state, '{}\n');
  const again = await p.build('2026-11-04T18:00:00Z');
  assert.match(again.summary, /, 0 new;/);
});

test('a feed of 150,000 tiny entries under the 5 MB cap builds, reads 500, and keeps the state small (engine-regressions-1)', async () => {
  const p = await project({ ...BASE, sources: [source('alpha', { filter: 'none' })] });
  let body = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>';
  for (let i = 0; i < 150000; i++) body += `<item><title>a<link>http://a/${i.toString(36)}`;
  body += '</channel></rss>';
  assert.ok(Buffer.byteLength(body) < MAX_BYTES);
  p.feeds.set('https://alpha.example/feed', { body });
  const t0 = performance.now();
  const r = await p.build(NOW);
  assert.ok(performance.now() - t0 < 30000, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(r.sources[0].status, 'ok');
  const state = await p.stateJson();
  assert.ok(Object.keys(state.seen).length <= 500, `${Object.keys(state.seen).length} seen ids`);
  assert.ok((await readFile(p.state)).length < 200 * 1024);
  assert.equal((await p.news()).items.length, 12, 'the per-source cap');
});
