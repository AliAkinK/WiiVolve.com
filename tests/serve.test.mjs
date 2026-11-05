// tools/serve.mjs must answer like Cloudflare, or local checks (tools/qa.mjs, the legacy-link checks in the
// RUNBOOK) test a different site than the one deployed. The table was recorded from `npx wrangler@4.157.0 dev`
// (the asset-serving code Cloudflare runs) against this site/ on 2026-11-04 (re-recorded for D11 and the case checks the same day): status, Location, Cache-Control and
// whether an ETag is sent. Re-record it with wrangler dev after changing site/_redirects or site/_headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.mjs';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

// [path, status, Location, Cache-Control, ETag sent]
const WRANGLER = [
  ['/', 200, '', 'public, max-age=0, must-revalidate', true],
  ['/fullNews.php?newsId=12', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/fullNews.php?newsId=213', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/FullNews.php?newsId=213', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/fullnews.php?newsid=213', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/fullNews.php/?NEWSID=213&page=2', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/FULLNEWS.PHP?newsId=267', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/article.php?articleId=13&page=1', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/review.php?articleId=77&page=1', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/preview.php?articleId=71&page=1', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/gameInfo.php?gameId=5', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/GameInfo.php?gameId=5', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/cheat.php?gameId=134', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/cheat.php?cheatId=36', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/cheats.php?gameId=134', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/cheats.php?gameId=134', '', false],
  ['/cheats.php?alpha=a', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/cheats.php?alpha=a', '', false],
  ['/index.php?system=Wii', 301, '/?system=Wii', '', false],
  ['/rss.php', 301, '/feed.xml', '', false],
  ['/d2w.php', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/d2w.php', '', false],
  ['/reviews.php?alpha=all', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/reviews.php?alpha=all', '', false],
  ['/staff.php', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/staff.php', '', false],
  ['/stats.php', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/stats.php', '', false],
  ['/screenshots.php', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/downloads/', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/downloads/', '', false],
  ['/downloads', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/Downloads/file.zip', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/images/header.gif', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/images/header.gif', '', false],
  ['/browser/ie.html', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/browser/ie.html', '', false],
  ['/error/404.html', 302, 'https://web.archive.org/web/2008/http://wiivolve.com/error/404.html', '', false],
  ['/some-random-page', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/404.html', 307, '/404', '', false],
  ['/404', 200, '', 'public, max-age=0, must-revalidate', true],
  ['/index.html?q=wii', 307, '/?q=wii', '', false],
  ['/index.html', 307, '/', '', false],
  ['/fonts/', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/fonts/missing.woff2', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/fonts/bricolage-grotesque-96.woff2', 200, '', 'public, max-age=31536000, immutable', true],
  ['/legacy/header-2009.webp', 200, '', 'public, max-age=31536000, immutable', true],
  ['/legacy/nope.webp', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/favicon.ico', 200, '', 'public, max-age=86400', true],
  ['/legacy-map.json', 200, '', 'public, max-age=0, must-revalidate', true],
  ['/health.json', 200, '', 'public, max-age=0, must-revalidate', true],
  ['/app.js', 200, '', 'public, max-age=0, must-revalidate', true],
  // Paths match exactly, case included (macOS file systems ignore case; Cloudflare does not), and the config files
  // are never served in any spelling.
  ['/STYLE.CSS', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/Feed.xml', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/Index.html', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/FONTS/bricolage-grotesque-96.woff2', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/_headers', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/_HEADERS', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/_Redirects', 404, '', 'public, max-age=0, must-revalidate', true],
  ['/.ASSETSIGNORE', 404, '', 'public, max-age=0, must-revalidate', true],
];
// Content-Type as wrangler dev sends it: JSON and XML without a charset parameter.
const TYPES = [['/news.json', 'application/json'], ['/legacy-map.json', 'application/json'], ['/feed.xml', 'application/xml'], ['/sitemap.xml', 'application/xml'], ['/', 'text/html; charset=utf-8'], ['/style.css', 'text/css; charset=utf-8']];

let server;
before(async () => {
  server = await startServer({ dir: SITE, port: 0 });
});
after(() => server.close());

test('serve.mjs answers like wrangler dev for old links, html handling, 404s and caching', async () => {
  for (const [url, status, location, cache, etag] of WRANGLER) {
    const res = await fetch(server.url + url, { redirect: 'manual', headers: { 'sec-fetch-mode': 'navigate' } });
    await res.arrayBuffer();
    assert.deepEqual(
      [res.status, res.headers.get('location') || '', res.headers.get('cache-control') || '', !!res.headers.get('etag')],
      [status, location, cache, etag],
      url,
    );
    assert.ok(res.headers.get('content-security-policy'), `${url}: the CSP is on every response`);
  }
  for (const [url, type] of TYPES) {
    const res = await fetch(server.url + url);
    await res.arrayBuffer();
    assert.equal(res.headers.get('content-type'), type, url);
  }
});

test('an ETag revalidates to 304', async () => {
  const first = await fetch(server.url + '/app.js');
  const etag = first.headers.get('etag');
  await first.arrayBuffer();
  const again = await fetch(server.url + '/app.js', { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('rule matching: static rules first, splats and :placeholders, 200 serves in place', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-serve-'));
  try {
    await writeFile(path.join(dir, 'index.html'), '<p>home</p>');
    await writeFile(path.join(dir, '404.html'), '<p>missing</p>');
    await writeFile(path.join(dir, 'target.html'), '<p>target</p>');
    await writeFile(path.join(dir, '_redirects'), [
      '/*.php                 https://example.com/old/:splat.php   302',
      '/blog/:year/*          /archive/:year/:splat                 301',
      '/proxy                 /target                               200',
      '/static.php            /static-home                          301',
    ].join('\n'));
    const local = await startServer({ dir, port: 0 });
    try {
      const get = async (u) => {
        const res = await fetch(local.url + u, { redirect: 'manual' });
        return [res.status, res.headers.get('location'), await res.text()];
      };
      assert.deepEqual((await get('/static.php')).slice(0, 2), [301, '/static-home'], 'a static rule beats an earlier splat');
      assert.deepEqual((await get('/News.php?x=1')).slice(0, 2), [302, 'https://example.com/old/News.php?x=1']);
      assert.deepEqual((await get('/blog/2007/a/b')).slice(0, 2), [301, '/archive/2007/a/b']);
      assert.deepEqual(await get('/proxy'), [200, null, '<p>target</p>'], 'served in place, at the original URL');
      assert.deepEqual(await get('/nothing'), [404, null, '<p>missing</p>']);
    } finally {
      await local.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
