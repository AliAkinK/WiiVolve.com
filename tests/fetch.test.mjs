// fetch.mjs against a fake fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeed, fetchAll, requestHeaders, readFixture, describeError, rateLimitOf, nextRequestDelay, BROWSER_UA, ACCEPT, HOST_GAP_MS, MAX_RATE_WAIT_MS } from '../scripts/lib/fetch.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const src = { id: 'nintendolife', url: 'https://www.nintendolife.com/feeds/latest' };
const opts = { userAgent: 'WiiVolveBot/1.0', retryDelayMs: 1 };

function fake(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, headers: init.headers, at: Date.now() });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    const nullBody = [101, 204, 205, 304].includes(status);
    return new Response(nullBody ? null : next.body ?? '', { status, headers: next.headers ?? {} });
  };
  return { impl, calls };
}

test('request headers: config UA, browser UA on request, Accept, conditional headers', () => {
  assert.deepEqual(requestHeaders(src, { userAgent: 'Bot/1' }), { 'User-Agent': 'Bot/1', Accept: ACCEPT });
  assert.equal(requestHeaders({ ...src, userAgent: 'browser' }, { userAgent: 'Bot/1' })['User-Agent'], BROWSER_UA);
  assert.match(BROWSER_UA, /Chrome\/\d+/);
  const h = requestHeaders(src, { userAgent: 'Bot/1', etag: 'W/"abc"', lastModified: 'Wed, 04 Nov 2026 06:08:00 GMT' });
  assert.equal(h['If-None-Match'], 'W/"abc"');
  assert.equal(h['If-Modified-Since'], 'Wed, 04 Nov 2026 06:08:00 GMT');
});

test('200: body decoded with the header charset; validators returned', async () => {
  const body = Buffer.from([0x3c, 0x74, 0x3e, 0x92, 0xe9, 0x3c, 0x2f, 0x74, 0x3e]);
  const { impl, calls } = fake([{ body, headers: { 'content-type': 'application/rss+xml; charset=windows-1252', etag: '"e1"', 'last-modified': 'Wed, 04 Nov 2026 06:08:00 GMT' } }]);
  const r = await fetchFeed(src, { ...opts, fetchImpl: impl });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.text, '<t>’é</t>');
  assert.equal(r.charset, 'windows-1252');
  assert.equal(r.etag, '"e1"');
  assert.equal(r.lastModified, 'Wed, 04 Nov 2026 06:08:00 GMT');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['User-Agent'], 'WiiVolveBot/1.0');
  assert.ok(Number.isInteger(r.ms));
});

test('304 counts as success and keeps the validators', async () => {
  const { impl, calls } = fake([{ status: 304 }]);
  const r = await fetchFeed(src, { ...opts, etag: '"e1"', lastModified: 'x', fetchImpl: impl });
  assert.deepEqual([r.ok, r.notModified, r.status, r.text, r.etag, r.lastModified], [true, true, 304, null, '"e1"', 'x']);
  assert.equal(calls[0].headers['If-None-Match'], '"e1"');
});

test('one retry on 5xx and network errors, none on 4xx', async () => {
  let f = fake([{ status: 503 }, { body: '<rss/>' }]);
  let r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);

  f = fake([{ status: 502 }, { status: 500 }]);
  r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.deepEqual([r.ok, r.status, r.error, r.attempts], [false, 500, 'HTTP 500', 2]);

  f = fake([new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }), { body: '<rss/>' }]);
  r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);

  f = fake([{ status: 429 }]);
  r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.deepEqual([r.ok, r.status, r.error, f.calls.length], [false, 429, 'HTTP 429', 1]);

  f = fake([{ status: 404 }]);
  r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  assert.equal(r.error, 'HTTP 404');
});

test('bodies over the size limit are rejected without retry', async () => {
  let f = fake([{ body: 'x'.repeat(500) }]);
  let r = await fetchFeed(src, { ...opts, maxBytes: 100, fetchImpl: f.impl });
  assert.equal(r.ok, false);
  assert.match(r.error, /body over/);
  assert.equal(f.calls.length, 1);
  f = fake([{ body: 'x', headers: { 'content-length': String(10 * 1024 * 1024) } }]);
  r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.equal(r.ok, false);
});

test('timeouts and odd errors become short messages', async () => {
  const f = fake([new DOMException('The operation was aborted due to timeout', 'TimeoutError')]);
  const r = await fetchFeed(src, { ...opts, fetchImpl: f.impl });
  assert.deepEqual([r.ok, r.status, r.error, r.attempts], [false, null, 'timeout', 2]);
  assert.equal(describeError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), 'ENOTFOUND');
  assert.equal(describeError(new Error('x'.repeat(300))).length <= 120, true);
});

test('fetchAll: same host one after another (order rotates), other hosts in parallel', async () => {
  const sources = [
    { id: 'reddit-wii', url: 'https://www.reddit.com/r/wii/.rss', userAgent: 'browser' },
    { id: 'reddit-wiihacks', url: 'https://www.reddit.com/r/WiiHacks/.rss', userAgent: 'browser' },
    { id: 'dolphin', url: 'https://dolphin-emu.org/blog/feeds/' },
  ];
  for (const [rotate, first] of [[0, 'r/wii'], [1, 'r/WiiHacks'], [2, 'r/wii']]) {
    const f = fake([{ body: '<rss/>' }]);
    const results = await fetchAll(sources, { userAgent: 'Bot', hostGapMs: 30, rotate, fetchImpl: f.impl, state: { sources: { dolphin: { etag: '"d"' } } } });
    assert.equal(results.size, 3);
    const reddit = f.calls.filter((c) => c.url.includes('reddit'));
    assert.ok(reddit[0].url.includes(first), `rotate ${rotate}`);
    assert.ok(reddit[1].at - reddit[0].at >= 25, 'gap between same-host requests');
    assert.equal(reddit[0].headers['User-Agent'], BROWSER_UA);
    assert.equal(f.calls.find((c) => c.url.includes('dolphin')).headers['If-None-Match'], '"d"');
  }
});

test('offline: fixtures are read from disk; a missing fixture is a failed fetch', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-fetch-'));
  try {
    await writeFile(path.join(dir, 'nintendolife.xml'), '<rss/>');
    const ok = await readFixture(src, dir);
    assert.deepEqual([ok.ok, ok.status, ok.text, ok.ms], [true, 200, '<rss/>', null]);
    const missing = await readFixture({ id: 'gone' }, dir);
    assert.deepEqual([missing.ok, missing.status, missing.error], [false, null, 'fixture missing']);
    const all = await fetchAll([src, { id: 'gone', url: 'https://x.example/' }], { offline: true, fixturesDir: dir });
    assert.equal(all.get('nintendolife').ok, true);
    assert.equal(all.get('gone').ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rate-limit headers: Reddit allows one .rss request per window, so the next same-host request waits for the reset', () => {
  const h = new Headers({ 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': '53', 'x-ratelimit-used': '1' });
  assert.deepEqual(rateLimitOf(h), { remaining: 0, reset: 53, retryAfter: null });
  assert.equal(nextRequestDelay({ status: 200, rateLimit: rateLimitOf(h) }), 54000);
  assert.equal(nextRequestDelay({ status: 200, rateLimit: { remaining: 5, reset: 53, retryAfter: null } }), HOST_GAP_MS, 'budget left: normal gap');
  assert.equal(nextRequestDelay({ status: 429, rateLimit: { remaining: null, reset: null, retryAfter: 20 } }), 21000);
  assert.equal(nextRequestDelay({ status: 200, rateLimit: { remaining: 0, reset: 3600, retryAfter: null } }), MAX_RATE_WAIT_MS, 'capped');
  assert.equal(nextRequestDelay({ status: 200, rateLimit: null }), HOST_GAP_MS);
  assert.equal(nextRequestDelay(null), HOST_GAP_MS);
  assert.equal(rateLimitOf(new Headers({ 'retry-after': 'soon' })).retryAfter, null);
});

test('fetchAll waits for the rate-limit window before the second same-host request', async () => {
  const sources = [
    { id: 'reddit-wii', url: 'https://www.reddit.com/r/wii/.rss', userAgent: 'browser' },
    { id: 'reddit-wiihacks', url: 'https://www.reddit.com/r/WiiHacks/.rss', userAgent: 'browser' },
  ];
  const f = fake([{ body: '<feed/>', headers: { 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': '1' } }]);
  const t0 = Date.now();
  const results = await fetchAll(sources, { userAgent: 'Bot', hostGapMs: 10, maxRateWaitMs: 250, fetchImpl: f.impl });
  assert.ok(Date.now() - t0 >= 240, 'waited for the (capped) reset');
  assert.ok([...results.values()].every((r) => r.ok));
  assert.deepEqual(results.get('reddit-wii').rateLimit, { remaining: 0, reset: 1, retryAfter: null });
});
