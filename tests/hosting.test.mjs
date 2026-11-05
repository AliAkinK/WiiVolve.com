// site/_headers and site/_redirects: Cloudflare drops a malformed line with only a warning in the deploy
// log, so a typo could silently disable a security header or the legacy-link handling. These checks use a
// strict reading of Cloudflare's formats and pin what docs/ARCHITECTURE.md sections 7.2 to 7.4 require.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const read = (f) => readFile(path.join(SITE, f), 'utf8');
const CODES = new Set([200, 301, 302, 303, 307, 308]);

/** _redirects -> [{ source, destination, code, line }]; throws on anything Cloudflare would reject. */
export function parseRedirects(text) {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const fields = line.split(/\s+/);
    const where = `_redirects line ${i + 1}`;
    if (fields.length < 2 || fields.length > 3) throw new Error(`${where}: expected "source destination [code]", got ${fields.length} fields`);
    const [source, destination, code = '302'] = fields;
    if (!source.startsWith('/')) throw new Error(`${where}: the source must start with "/"`);
    if (!/^\d{3}$/.test(code) || !CODES.has(Number(code))) throw new Error(`${where}: unsupported status ${code}`);
    if (!destination.startsWith('/') && !/^https:\/\//.test(destination)) throw new Error(`${where}: the destination must be a path or an https URL`);
    rules.push({ source, destination, code: Number(code), line: i + 1, dynamic: /[*:]/.test(source) });
  });
  return rules;
}

/** _headers -> [{ path, headers: [[name, value]] }]; throws on anything Cloudflare would reject. */
export function parseHeaders(text) {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const where = `_headers line ${i + 1}`;
    if (!raw.trim() || /^#/.test(raw)) return;
    if (/^\s+#/.test(raw)) throw new Error(`${where}: comments must start at the beginning of a line`);
    if (!/^\s/.test(raw)) {
      if (!raw.startsWith('/')) throw new Error(`${where}: a path line must start with "/"`);
      rules.push({ path: raw.trim(), headers: [] });
      return;
    }
    const m = /^\s+(!\s*)?([A-Za-z0-9-]+)(?::\s*(.*))?$/.exec(raw);
    if (!m || (!m[1] && m[3] === undefined)) throw new Error(`${where}: expected "  Name: value"`);
    if (!rules.length) throw new Error(`${where}: a header before any path`);
    rules.at(-1).headers.push([m[2], m[3] ?? null]);
  });
  return rules;
}

/** A _redirects source as Cloudflare matches it: exact, case-sensitive, "*" for any text, ":name" for one segment. */
const toRegex = (source) => new RegExp(`^${source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+')}$`);

test('_redirects parses strictly, within Cloudflare limits, static rules before dynamic ones', async () => {
  const rules = parseRedirects(await read('_redirects'));
  assert.ok(rules.filter((r) => !r.dynamic).length <= 2000 && rules.filter((r) => r.dynamic).length <= 100);
  const firstDynamic = rules.findIndex((r) => r.dynamic);
  assert.ok(firstDynamic === -1 || rules.slice(firstDynamic).every((r) => r.dynamic), 'static rules come first, as Cloudflare checks them first');
  assert.equal(new Set(rules.map((r) => r.source)).size, rules.length, 'no source appears twice');
});

test('_redirects: new homes are permanent, the archive is a 302 that keeps the query string', async () => {
  const rules = parseRedirects(await read('_redirects'));
  const by = Object.fromEntries(rules.map((r) => [r.source, r]));
  assert.deepEqual([by['/rss.php'].destination, by['/rss.php'].code], ['/feed.xml', 301]);
  assert.deepEqual([by['/index.php'].destination, by['/index.php'].code], ['/', 301]);
  for (const r of rules.filter((x) => x.destination.startsWith('https://web.archive.org/'))) {
    assert.equal(r.code, 302, `${r.source}: browsers keep a 301 for good`);
    assert.match(r.destination, /^https:\/\/web\.archive\.org\/web\/2008\/http:\/\/wiivolve\.com\//, r.source);
    assert.ok(!r.destination.includes('?'), `${r.source}: a destination without its own query keeps the incoming one`);
  }
  for (const dir of ['downloads', 'images', 'browser', 'gigazero', 'error']) assert.ok(by[`/${dir}/*`], `/${dir}/* has a rule`);
});

test('_redirects never answers the endpoints with an id, in any spelling: 404.js and legacy-map.json do (D7, D11)', async () => {
  const rules = parseRedirects(await read('_redirects'));
  const paths = ['/fullNews.php', '/FullNews.php', '/fullnews.php', '/article.php', '/review.php', '/preview.php', '/Review.php', '/gameInfo.php', '/GameInfo.php', '/cheat.php', '/Cheat.php'];
  for (const p of paths) {
    const hit = rules.find((r) => toRegex(r.source).test(p));
    assert.equal(hit, undefined, `${p} must reach site/404.html, but line ${hit?.line} (${hit?.source}) answers it`);
  }
  // Every other old .php endpoint the 404 fallback knows keeps its edge rule.
  const js = await read('404.js');
  const known = /const KNOWN = '([^']+)'/.exec(js)[1].split(' ');
  const withId = new Set(['fullNews', 'article', 'review', 'preview', 'gameInfo', 'cheat']);
  for (const name of known.filter((k) => !withId.has(k))) assert.ok(rules.some((r) => r.source === `/${name}.php`), `/${name}.php has an edge rule`);
  // The list pages the map sends unknown ids to keep their edge rules (cheats.php, games.php, news.php, ...).
  for (const name of ['news', 'articles', 'reviews', 'previews', 'games', 'cheats']) assert.ok(rules.some((r) => r.source === `/${name}.php`), `/${name}.php`);
});

test('_headers parses strictly; every path gets the security headers of section 7.3; named files exist', async () => {
  const rules = parseHeaders(await read('_headers'));
  assert.ok(rules.length <= 100);
  const all = rules.find((r) => r.path === '/*');
  assert.ok(all, 'a /* rule');
  const h = Object.fromEntries(all.headers);
  assert.equal(h['Content-Security-Policy'], "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(h['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(h['Strict-Transport-Security'], 'max-age=31536000');
  assert.equal(all.headers.length, 6, 'exactly the section 7.3 headers');
  for (const r of rules.filter((x) => x.path !== '/*')) {
    assert.ok(!r.path.includes('*'), `${r.path}: cache rules name files (a splat would also cache 404s for a year)`);
    assert.ok(existsSync(path.join(SITE, r.path)), `${r.path} exists in site/`);
    const cc = r.headers.filter(([n]) => n === 'Cache-Control');
    assert.equal(cc.length, 1, `${r.path}: one Cache-Control`);
  }
});

test('the strict parsers reject the mistakes Cloudflare would only warn about', () => {
  assert.throws(() => parseRedirects('/oops.php https://example.com/ 999'), /unsupported status/);
  assert.throws(() => parseRedirects('/review.php /404 200 extra'), /fields/);
  assert.throws(() => parseHeaders('/*\n  Cache-Control public no colon'), /Name: value/);
  assert.throws(() => parseHeaders('/*\n  # indented comment'), /beginning of a line/);
});
