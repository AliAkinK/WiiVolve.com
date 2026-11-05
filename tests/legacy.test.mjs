// Old wiivolve.com links: the legacy map (scripts/build-legacy-map.mjs, site/legacy-map.json) and the
// browser-side bounce in site/404.js, run in node:vm with a stub location, document and fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLegacyMap, legacyKey, renderLegacyMap, capturedPages, ARTICLE_ENDPOINTS, ID_ENDPOINTS, LIST_PAGES } from '../scripts/build-legacy-map.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = await readFile(path.join(ROOT, 'site', '404.js'), 'utf8');
const headlines = JSON.parse(await readFile(path.join(ROOT, 'legacy-assets', 'headlines-full.json'), 'utf8'));
const INDEX = JSON.parse(await readFile(path.join(ROOT, 'legacy-assets', 'wayback-url-index.json'), 'utf8'));
const FACTS = await readFile(path.join(ROOT, 'legacy-assets', 'FACTS.md'), 'utf8');
const MAP = buildLegacyMap(headlines, INDEX);
const WAYBACK_2008 = 'https://web.archive.org/web/2008/http://wiivolve.com';

test('legacyKey: endpoint and id parameter in any case, a trailing slash, extra parameters ignored', () => {
  assert.equal(legacyKey('/fullNews.php', '?newsId=267'), 'fullnews.php?newsid=267');
  assert.equal(legacyKey('/FullNews.php/', '?NEWSID=0267&page=1'), 'fullnews.php?newsid=267');
  assert.equal(legacyKey('/review.php', '?page=1&articleId=77'), 'review.php?articleid=77');
  assert.equal(legacyKey('/fullNews.php', '?newsId=abc'), null, 'the id is a number');
  assert.equal(legacyKey('/fullNews.php', ''), null, 'no id, no key');
  assert.equal(legacyKey('/GameInfo.php', '?gameid=05'), 'gameinfo.php?gameid=5');
  assert.equal(legacyKey('/cheat.php', '?cheatId=36'), 'cheat.php?cheatid=36');
  assert.equal(legacyKey('/cheat.php', '?gameId=134'), 'cheat.php?gameid=134', 'a cheat page by its game');
  assert.equal(legacyKey('/screenshots.php', '?id=3'), null, 'not an endpoint with an id');
  assert.deepEqual(Object.keys(ARTICLE_ENDPOINTS).sort(), ['article.php', 'fullnews.php', 'preview.php', 'review.php']);
  assert.deepEqual(Object.keys(ID_ENDPOINTS).sort(), ['article.php', 'cheat.php', 'fullnews.php', 'gameinfo.php', 'preview.php', 'review.php']);
});

test('the map covers every documented post, feature, review and preview with its best capture', () => {
  assert.equal(Object.keys(MAP).length, 1 + 289 + 24, '_list, the articles, the captured game and cheat pages');
  const count = (e) => Object.keys(MAP).filter((k) => k.startsWith(`${e}?`)).length;
  assert.deepEqual([count('fullnews.php'), count('review.php'), count('article.php'), count('preview.php')], [220, 40, 21, 8]);
  assert.equal(MAP['fullnews.php?newsid=267'], 'https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267');
  assert.equal(MAP['fullnews.php?newsid=213'], 'https://web.archive.org/web/20070614103113/http://wiivolve.com/fullNews.php?newsId=213');
  assert.equal(MAP['review.php?articleid=77'], 'https://web.archive.org/web/20070507042621/http://wiivolve.com/review.php?articleId=77&page=1');
  assert.match(MAP['fullnews.php?newsid=13'], /news\.php\?system=Wii$/, 'a post without its own capture goes to the list that holds it');
  assert.equal(MAP['fullnews.php?newsid=12'], undefined, 'newsId 12 was never documented');
  assert.equal(renderLegacyMap(buildLegacyMap(structuredClone(headlines).reverse(), [INDEX[0], ...INDEX.slice(1).reverse()])), renderLegacyMap(MAP), 'deterministic');
  assert.throws(() => buildLegacyMap([...headlines, headlines[0]]), /duplicate/);
  assert.throws(() => buildLegacyMap([{ ...headlines[0], bestArchiveUrl: 'javascript:alert(1)' }]), /not a Wayback capture/);
});

test('the map has every game and cheat page the Wayback Machine captured, and a list page per endpoint (D11)', () => {
  const count = (e) => Object.keys(MAP).filter((k) => k.startsWith(`${e}?`)).length;
  // The index holds 200 captures of 7 game pages and 17 cheat pages (5 by cheatId, 12 by gameId; 41 is both).
  assert.deepEqual([count('gameinfo.php'), count('cheat.php')], [7, 17]);
  assert.equal(MAP['gameinfo.php?gameid=5'], 'https://web.archive.org/web/20110721060124/http://wiivolve.com/gameInfo.php?gameId=5');
  assert.equal(MAP['cheat.php?cheatid=36'], 'https://web.archive.org/web/20070614103158/http://wiivolve.com/cheat.php?cheatId=36');
  assert.equal(MAP['cheat.php?gameid=134'], 'https://web.archive.org/web/20071011054140/http://wiivolve.com/cheat.php?gameId=134');
  assert.equal(MAP['gameinfo.php?gameid=8'], 'https://web.archive.org/web/20070217065453/http://wiivolve.com/gameInfo.php?gameId=8', 'not the odd /NcNeX/gameInfo.php path the index also lists');
  assert.equal(capturedPages(INDEX).length, 24);
  assert.deepEqual(Object.keys(MAP._list).sort(), Object.keys(ID_ENDPOINTS).sort());
  assert.deepEqual(MAP._list, LIST_PAGES);
  // Each list page is a capture the evidence documents: FACTS.md quotes it, or the URL index lists its URL.
  for (const [endpoint, url] of Object.entries(LIST_PAGES)) {
    const [, ts, page] = /^https:\/\/web\.archive\.org\/web\/(\d{14})\/http:\/\/wiivolve\.com\/(.+)$/.exec(url);
    const inIndex = INDEX.some(([original, t, st]) => t === ts && st === '200' && original.replace(/^http:\/\/(www\.)?wiivolve\.com(:80)?\//, '') === page);
    assert.ok(FACTS.includes(url) || inIndex, `${endpoint}: ${url}`);
  }
});

test('site/legacy-map.json is a valid map (invariants only, so a hand-fixed link stays allowed)', async () => {
  const map = JSON.parse(await readFile(path.join(ROOT, 'site', 'legacy-map.json'), 'utf8'));
  assert.ok(Object.keys(map).length > 0);
  const { _list: list = {}, ...ids } = map;
  for (const [endpoint, v] of Object.entries(list)) {
    assert.ok(endpoint in ID_ENDPOINTS, endpoint);
    assert.match(v, /^https:\/\/web\.archive\.org\/web\/\d{4,14}\/http:\/\/wiivolve\.com\//, endpoint);
  }
  for (const [k, v] of Object.entries(ids)) {
    const [endpoint, query] = k.split('?');
    assert.equal(legacyKey(`/${endpoint}`, `?${query}`), k, k);
    assert.match(v, /^https:\/\/web\.archive\.org\/web\/\d{4,14}\/http:\/\/wiivolve\.com\//, k);
  }
});

/** Run site/404.js for a URL. Returns { to, lit, fetched } once it has redirected (or settled without one). */
async function bounce(url, { map = MAP, fetchFails = false, fetchHangs = false } = {}) {
  const u = new URL(url, 'https://wiivolve.com');
  const state = { to: null, lit: false, fetched: [], timers: [] };
  let done;
  const finished = new Promise((r) => (done = r));
  const sandbox = {
    URLSearchParams,
    location: { pathname: u.pathname, search: u.search, replace: (to) => { state.to = to; done(); } },
    document: {
      documentElement: { classList: { add: (c) => { if (c === 'lit') state.lit = true; } } },
      addEventListener: () => {},
      getElementById: () => null,
    },
    setTimeout: (fn, ms) => state.timers.push({ fn, ms }),
    fetch: (resource) => {
      state.fetched.push(resource);
      if (fetchHangs) return new Promise(() => {});
      if (fetchFails) return Promise.reject(new TypeError('offline'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(map) });
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SCRIPT, sandbox);
  if (fetchHangs) state.timers.find((t) => t.ms === 4000)?.fn();
  await Promise.race([finished, new Promise((r) => setImmediate(r))]);
  await new Promise((r) => setImmediate(r));
  return state;
}

test('404.js: article links go to their best capture, in any spelling', async () => {
  for (const url of ['/fullNews.php?newsId=213', '/FullNews.php?newsId=213', '/fullnews.php?newsid=213', '/FULLNEWS.PHP/?NEWSID=0213&page=2']) {
    const r = await bounce(url);
    assert.equal(r.to, MAP['fullnews.php?newsid=213'], url);
    assert.ok(r.lit, 'the console glows during the bounce');
    assert.deepEqual(r.fetched, ['/legacy-map.json']);
  }
  assert.equal((await bounce('/review.php?articleId=77&page=1')).to, MAP['review.php?articleid=77']);
  assert.equal((await bounce('/preview.php?articleId=71&page=1')).to, MAP['preview.php?articleid=71']);
});

test('404.js: game and cheat pages go to their capture; an id the map does not know, to the list of its endpoint (D11)', async () => {
  for (const [url, key] of [['/gameInfo.php?gameId=5', 'gameinfo.php?gameid=5'], ['/GameInfo.php/?GAMEID=0062', 'gameinfo.php?gameid=62'], ['/cheat.php?cheatId=36', 'cheat.php?cheatid=36'], ['/cheat.php?gameId=134', 'cheat.php?gameid=134']]) {
    const r = await bounce(url);
    assert.equal(r.to, MAP[key], url);
    assert.deepEqual(r.fetched, ['/legacy-map.json']);
  }
  const lists = {
    '/fullNews.php?newsId=12': 'fullnews.php', // never documented
    '/article.php?articleId=999': 'article.php',
    '/Review.php?articleId=999&page=1': 'review.php',
    '/preview.php?articleId=999': 'preview.php',
    '/gameInfo.php?gameId=268': 'gameinfo.php', // GALAGA '90*: in the games list, no page of its own
    '/cheat.php?gameId=999': 'cheat.php',
  };
  for (const [url, endpoint] of Object.entries(lists)) assert.equal((await bounce(url)).to, MAP._list[endpoint], url);
});

test('404.js: a failed or slow map, or a bad map value, falls back to the 2008 form', async () => {
  assert.equal((await bounce('/fullNews.php?newsId=12', { map: { 'fullnews.php?newsid=213': MAP['fullnews.php?newsid=213'] } })).to, `${WAYBACK_2008}/fullNews.php?newsId=12`, 'a map without _list');
  assert.equal((await bounce('/fullnews.php?newsid=213', { fetchFails: true })).to, `${WAYBACK_2008}/fullNews.php?newsid=213`, 'old spelling restored, query kept');
  assert.equal((await bounce('/fullNews.php?newsId=213', { fetchHangs: true })).to, `${WAYBACK_2008}/fullNews.php?newsId=213`);
  assert.equal((await bounce('/fullNews.php?newsId=213', { map: { 'fullnews.php?newsid=213': 'javascript:alert(1)' } })).to, `${WAYBACK_2008}/fullNews.php?newsId=213`);
  assert.equal((await bounce('/fullNews.php?newsId=12', { map: { _list: { 'fullnews.php': 'javascript:alert(1)' } } })).to, `${WAYBACK_2008}/fullNews.php?newsId=12`);
  assert.equal((await bounce('/gameInfo.php?gameId=5', { fetchFails: true })).to, `${WAYBACK_2008}/gameInfo.php?gameId=5`);
  const noId = await bounce('/article.php');
  assert.equal(noId.to, `${WAYBACK_2008}/article.php`);
  assert.deepEqual(noId.fetched, [], 'no id: no map needed');
});

test('404.js: other old pages and folders keep their 2008 form, new homes and unknown paths', async () => {
  const cases = {
    '/gameinfo.php': `${WAYBACK_2008}/gameInfo.php`, // no id: nothing to look up
    '/Cheats.php?alpha=a': `${WAYBACK_2008}/cheats.php?alpha=a`,
    '/Downloads/file.zip': `${WAYBACK_2008}/downloads/file.zip`,
    '/downloads': `${WAYBACK_2008}/downloads`,
    '/screenshots.php': `${WAYBACK_2008}/screenshots.php`,
    '/RSS.PHP': '/feed.xml',
    '/Index.php?system=Wii': '/?system=Wii',
  };
  for (const [url, to] of Object.entries(cases)) {
    const r = await bounce(url);
    assert.equal(r.to, to, url);
    assert.deepEqual(r.fetched, [], `${url}: no map lookup`);
  }
  const none = await bounce('/some-random-page');
  assert.equal(none.to, null, 'a page that never existed stays on "No disc inserted."');
  assert.equal(none.lit, false);
});
