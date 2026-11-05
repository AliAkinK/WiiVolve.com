#!/usr/bin/env node
// Builds site/legacy-map.json, which site/404.js reads to send an old link to a page that exists (docs/
// ARCHITECTURE.md section 7.4):
//   - each documented post, feature, review and preview of the old site (289, legacy-assets/headlines-full.json),
//     to its best Wayback capture: 188 of the 220 posts have no capture of their own, so the Wayback "2008"
//     form of their URL lands on "not archived";
//   - each game page and cheat page the Wayback Machine captured (legacy-assets/wayback-url-index.json, status
//     200), to that capture;
//   - under "_list", each of those endpoints to the best capture of the old site's own list of its items, for
//     an id the map does not know.
//
//   node scripts/build-legacy-map.mjs        (npm run legacy-map)
//
// Keys are lowercase "<endpoint>.php?<id parameter>=<id>", for example "fullnews.php?newsid=267",
// "review.php?articleid=77", "gameinfo.php?gameid=5" and "cheat.php?cheatid=36". Values are
// https://web.archive.org/web/<timestamp>/... URLs. The output is deterministic ("_list" first, then sorted by
// endpoint and numeric id). Exit code 1 on bad input. Node built-ins only.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicWrite } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The old article endpoints and the query parameter that carries their id (lowercase). */
export const ARTICLE_ENDPOINTS = { 'fullnews.php': 'newsid', 'article.php': 'articleid', 'review.php': 'articleid', 'preview.php': 'articleid' };

/** Every old endpoint with an id, and the query parameters that carry it (lowercase). site/404.js has the same list. */
export const ID_ENDPOINTS = {
  ...Object.fromEntries(Object.entries(ARTICLE_ENDPOINTS).map(([e, p]) => [e, [p]])),
  'gameinfo.php': ['gameid'],
  'cheat.php': ['cheatid', 'gameid'], // a cheat page was linked by its own id or by its game's
};

/**
 * The old site's own list of each endpoint's items, at its best capture: where an id the map does not know goes.
 * All but the cheats list are documented and checked in legacy-assets/FACTS.md section 2 (the URL index stops
 * before "reviews"); the cheats A to Z list is a capture in legacy-assets/wayback-url-index.json.
 */
export const LIST_PAGES = {
  'fullnews.php': 'https://web.archive.org/web/20080208231423/http://wiivolve.com/news.php?system=Wii',
  'article.php': 'https://web.archive.org/web/20080208231355/http://wiivolve.com/articles.php?system=Wii',
  'review.php': 'https://web.archive.org/web/20080129225758/http://wiivolve.com/reviews.php?alpha=all&system=',
  'preview.php': 'https://web.archive.org/web/20080208231436/http://wiivolve.com/previews.php?system=Wii',
  'gameinfo.php': 'https://web.archive.org/web/20080208231410/http://wiivolve.com/games.php?system=Wii',
  'cheat.php': 'https://web.archive.org/web/20071217203827/http://wiivolve.com/cheats.php?alpha=all&system=',
};

const WAYBACK = /^https:\/\/web\.archive\.org\/web\/\d{4,14}\/http:\/\/wiivolve\.com\//;

/**
 * The map key for an old URL with an id, or null when it is not one: the endpoint in any case, a trailing
 * slash after ".php" allowed, the id parameter in any case (the first the endpoint knows), other parameters
 * ignored, the id as a plain number.
 * @param {string} pathname e.g. "/FullNews.php/"
 * @param {string} search e.g. "?NEWSID=0267&page=1"
 */
export function legacyKey(pathname, search = '') {
  const m = /^\/([\w-]+\.php)\/?$/i.exec(String(pathname));
  const endpoint = m && m[1].toLowerCase();
  const params = endpoint && ID_ENDPOINTS[endpoint];
  if (!params) return null;
  for (const [name, value] of new URLSearchParams(search)) {
    const param = name.toLowerCase();
    if (params.includes(param) && /^\d{1,9}$/.test(value)) return `${endpoint}?${param}=${Number(value)}`;
  }
  return null;
}

/**
 * wayback-url-index.json rows ([original, timestamp, statuscode], a header row first) -> [{ key, url }] for the
 * game and cheat pages captured with status 200, linked with the old site's own spelling of the URL.
 */
export function capturedPages(index) {
  if (!Array.isArray(index) || !index.length) throw new Error('wayback-url-index.json: expected a non-empty array');
  const out = [];
  for (const [original, timestamp, status] of index.slice(1)) {
    if (status !== '200' || !/^\d{14}$/.test(timestamp)) continue;
    let u;
    try {
      u = new URL(original);
    } catch {
      continue;
    }
    if (!/^(www\.)?wiivolve\.com$/.test(u.hostname) || !/^\/(gameInfo|cheat)\.php$/.test(u.pathname)) continue;
    const key = legacyKey(u.pathname, u.search);
    if (key) out.push({ key, url: `https://web.archive.org/web/${timestamp}/http://wiivolve.com${u.pathname}${u.search}` });
  }
  return out;
}

/**
 * headlines-full.json entries (and the URL index, for the game and cheat pages) -> { _list, key: url }, sorted.
 * Throws on a bad or duplicate entry.
 */
export function buildLegacyMap(entries, index = null) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('headlines-full.json: expected a non-empty array');
  const rows = [];
  const seen = new Set();
  const add = (key, url) => {
    if (seen.has(key)) throw new Error(`duplicate entry: ${key}`);
    if (typeof url !== 'string' || !WAYBACK.test(url)) throw new Error(`${key}: bestArchiveUrl is not a Wayback capture: ${url}`);
    seen.add(key);
    const [endpoint, rest] = key.split('?');
    rows.push({ key, endpoint, id: Number(rest.split('=')[1]), url });
  };
  for (const e of entries) {
    let u;
    try {
      u = new URL(e?.originalUrl);
    } catch {
      throw new Error(`bad originalUrl: ${JSON.stringify(e?.originalUrl)}`);
    }
    const key = legacyKey(u.pathname, u.search);
    if (!key || !ARTICLE_ENDPOINTS[key.split('?')[0]]) throw new Error(`not an article URL: ${e.originalUrl}`);
    add(key, e.bestArchiveUrl);
  }
  if (index) for (const { key, url } of capturedPages(index)) add(key, url);
  // By endpoint, then id; a cheat's cheatId and gameId pages with the same number by key.
  rows.sort((a, b) => (a.endpoint !== b.endpoint ? (a.endpoint < b.endpoint ? -1 : 1) : a.id - b.id || (a.key < b.key ? -1 : 1)));
  return { _list: { ...LIST_PAGES }, ...Object.fromEntries(rows.map((r) => [r.key, r.url])) };
}

export function renderLegacyMap(map) {
  return `${JSON.stringify(map, null, 1)}\n`;
}

export async function main({
  input = path.join(ROOT, 'legacy-assets', 'headlines-full.json'),
  index = path.join(ROOT, 'legacy-assets', 'wayback-url-index.json'),
  output = path.join(ROOT, 'site', 'legacy-map.json'),
} = {}) {
  const map = buildLegacyMap(JSON.parse(await readFile(input, 'utf8')), JSON.parse(await readFile(index, 'utf8')));
  await atomicWrite(output, renderLegacyMap(map));
  const counts = {};
  for (const k of Object.keys(map).filter((k) => k !== '_list')) counts[k.split('?')[0]] = (counts[k.split('?')[0]] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`${path.relative(process.cwd(), output)}: ${total} entries (${Object.entries(counts).map(([e, n]) => `${e} ${n}`).join(', ')}) and ${Object.keys(map._list).length} list pages`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`build-legacy-map: ${err.message}\n`);
    process.exitCode = 1;
  }
}
