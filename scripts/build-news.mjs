#!/usr/bin/env node
// WiiVolve builder: fetch → parse → normalize → filter → select → render → write.
// See docs/ARCHITECTURE.md section 5.
//
//   node scripts/build-news.mjs [--offline] [--fixtures tests/fixtures] [--out site] [--state state/state.json]
//                               [--config feeds.json] [--now 2026-11-04T16:17:00Z] [--force] [--quiet]
//
// Exit code 0 unless there is a programming (or configuration) error. Network failures are data.

import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAll } from './lib/fetch.mjs';
import { parseFeed } from './lib/parse.mjs';
import { normalizeEntry, isHttpUrl } from './lib/text.mjs';
import { compileKeywords, compileExcludes, applyFilter } from './lib/filter.mjs';
import { selectItems, sortItems, toItem } from './lib/select.mjs';
import { renderRss, renderJsonFeed } from './lib/feeds-out.mjs';
import { renderPage } from './lib/render.mjs';
import { atomicWrite, readJSON, readText, sha256Hex, stableJSON, isoSeconds, itemId, utcDay, parseJsonLoose, HOUR, DAY } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_ITEMS_MAX = 50;
const SEEN_DAYS = 45;
const DOWN_AFTER = 3;
// Bump whenever parse.mjs, text.mjs or filter.mjs change which entries are kept or how they read. With the
// filter rules from feeds.json it forms state.rulesHash (section 5.10): a change refetches every feed in full
// and re-checks the stories already shown, so new rules reach them and sources that answer 304.
// 3: excerpts join their paragraphs with " — " where a sentence would otherwise run on.
export const ENGINE_VERSION = 3;
const DISCOVERY_GRACE_MS = 48 * HOUR;
const FUTURE_TOLERANCE_MS = HOUR;

export class UsageError extends Error {}

export const USAGE = `Usage: node scripts/build-news.mjs [--offline] [--fixtures DIR] [--out DIR] [--state FILE]
                              [--config FILE] [--now ISO] [--force] [--quiet]`;

/** Parse CLI flags (both "--flag value" and "--flag=value"). */
export function parseArgs(argv) {
  const opts = { offline: false, force: false, quiet: false, fixtures: null, out: null, state: null, config: null, now: null, template: null, help: false };
  const valued = { '--fixtures': 'fixtures', '--out': 'out', '--state': 'state', '--config': 'config', '--now': 'now', '--template': 'template' };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (arg === '--offline') opts.offline = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (valued[arg]) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${arg} needs a value`);
      opts[valued[arg]] = value;
    } else throw new UsageError(`unknown option: ${argv[i]}`);
  }
  return opts;
}

function resolveFrom(base, p, fallback) {
  if (!p) return path.join(ROOT, fallback);
  return path.resolve(base, p);
}

const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Validate feeds.json; throws on anything the builder cannot work with. A wrong type fails the build
 * (exit 1, the live site keeps its last good deploy) instead of silently emptying the page: a string
 * where a list belongs would otherwise be read letter by letter.
 */
export function validateConfig(cfg) {
  const fail = (msg) => {
    throw new Error(`feeds.json: ${msg}`);
  };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) fail('not an object');
  if (!cfg.site || typeof cfg.site.url !== 'string' || !isHttpUrl(cfg.site.url)) fail('site.url must be an http(s) URL');
  if (!Array.isArray(cfg.sources) || !cfg.sources.length) fail('sources must be a non-empty array');
  const ids = new Set();
  for (const s of cfg.sources) {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) fail(`bad source id ${JSON.stringify(s?.id)}`);
    if (ids.has(s.id)) fail(`duplicate source id ${s.id}`);
    ids.add(s.id);
    if (s.id === 'wiivolve') fail('source id "wiivolve" is reserved for archive items');
    if (typeof s.name !== 'string' || !s.name) fail(`${s.id}: name missing`);
    if (!isHttpUrl(s.url)) fail(`${s.id}: url must be http(s)`);
    if (s.tab !== 'press' && s.tab !== 'scene') fail(`${s.id}: tab must be "press" or "scene"`);
    if (s.filter && s.filter !== 'keywords' && s.filter !== 'none') fail(`${s.id}: filter must be "keywords" or "none"`);
    if (s.strip !== undefined && !isStringList(s.strip)) fail(`${s.id}: strip must be a list of strings, for example ["Read more"]`);
    if (s.maxItems !== undefined && !(Number.isInteger(s.maxItems) && s.maxItems >= 1)) fail(`${s.id}: maxItems must be a whole number of at least 1`);
    if (s.priority !== undefined && !Number.isFinite(s.priority)) fail(`${s.id}: priority must be a number`);
    if (s.userAgent !== undefined && (typeof s.userAgent !== 'string' || !s.userAgent.trim())) fail(`${s.id}: userAgent must be a non-empty string`);
  }
  const sel = cfg.selection || {};
  for (const k of ['windowDays', 'minItems', 'maxAgeDays', 'maxItems', 'maxPerSource']) {
    if (!Number.isFinite(sel[k]) || sel[k] < 0) fail(`selection.${k} must be a non-negative number`);
  }
  if (sel.maxPerSource < 1) fail('selection.maxPerSource must be at least 1');
  for (const k of ['minPerSource', 'minPerTab']) {
    if (sel[k] !== undefined && !(Number.isInteger(sel[k]) && sel[k] >= 0)) fail(`selection.${k} must be a whole number of at least 0`);
  }
  if (sel.minItems > sel.maxItems) fail('selection.minItems must not be larger than selection.maxItems');
  if (!isStringList(cfg.keywords)) fail('keywords must be a list of strings');
  if (cfg.exclude !== undefined && !isStringList(cfg.exclude)) fail('exclude must be a list of strings, for example ["megathread"]');
  if (cfg.wiiU !== undefined && typeof cfg.wiiU !== 'boolean') fail('wiiU must be true or false');
  return cfg;
}

/** The page template must exist and carry the stream and status slots; an empty page is never published. */
export function validateTemplate(template, templatePath) {
  if (!template || !template.trim()) throw new Error(`template missing or empty: ${templatePath}`);
  for (const slot of ['stream', 'status']) {
    if (!template.includes(`<!--@${slot}-->`)) throw new Error(`template ${templatePath} has no <!--@${slot}--> slot`);
  }
  return template;
}

function emptySourceState() {
  return { etag: null, lastModified: null, lastOk: null, lastAttempt: null, failures: 0, httpStatus: null, error: null, items: [] };
}

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** State file → clean state for the configured sources (unknown sources are forgotten). */
function normalizeState(raw, sources) {
  const state = { version: 1, signature: null, rulesHash: null, lastWrite: null, seen: {}, sources: {} };
  if (raw && typeof raw === 'object') {
    if (typeof raw.signature === 'string') state.signature = raw.signature;
    if (typeof raw.rulesHash === 'string') state.rulesHash = raw.rulesHash;
    if (isIso(raw.lastWrite)) state.lastWrite = raw.lastWrite;
    if (raw.seen && typeof raw.seen === 'object') {
      for (const [id, v] of Object.entries(raw.seen)) if (isIso(v)) state.seen[id] = isoSeconds(Date.parse(v));
    }
  }
  for (const s of sources) {
    const prev = raw?.sources?.[s.id];
    const mem = emptySourceState();
    if (prev && typeof prev === 'object') {
      for (const k of ['etag', 'lastModified', 'error']) if (typeof prev[k] === 'string') mem[k] = prev[k];
      for (const k of ['lastOk', 'lastAttempt']) if (isIso(prev[k])) mem[k] = prev[k];
      if (Number.isInteger(prev.failures) && prev.failures > 0) mem.failures = prev.failures;
      if (Number.isInteger(prev.httpStatus)) mem.httpStatus = prev.httpStatus;
      if (Array.isArray(prev.items)) mem.items = prev.items.filter((it) => it && typeof it === 'object' && it.sourceId === s.id);
    }
    state.sources[s.id] = mem;
  }
  return state;
}

/**
 * state.rulesHash (section 5.10): the filter rules of feeds.json and the engine version. When it differs from
 * the stored one, the run fetches every feed in full and re-checks the stories already shown or cached.
 */
export function rulesHashOf(config, engine = ENGINE_VERSION) {
  return sha256Hex(
    stableJSON({
      engine,
      keywords: config.keywords,
      wiiU: !!config.wiiU,
      exclude: config.exclude ?? [],
      sources: config.sources.map((s) => [s.id, s.filter ?? 'none', s.strip ?? [], !!s.aggregator, s.tab]),
    }),
  );
}

/** feeds.json#site with `repo` resolved: site.repo, else GITHUB_SERVER_URL + GITHUB_REPOSITORY, else null. */
export function resolveSite(site, env = process.env) {
  let repo = typeof site.repo === 'string' && isHttpUrl(site.repo) ? site.repo.replace(/\/+$/, '') : null;
  if (!repo && env.GITHUB_REPOSITORY) {
    const server = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
    const candidate = `${server}/${env.GITHUB_REPOSITORY}`;
    if (isHttpUrl(candidate)) repo = candidate;
  }
  return { ...site, url: String(site.url).replace(/\/+$/, ''), repo };
}

/** site/archive.json -> { version, items }. Missing is allowed (no deep-end items); present but broken fails the build. */
export function parseArchive(text, file = 'archive.json') {
  if (text === null) return { version: 1, items: [] };
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}); fix it or restore it from git`);
  }
  if (!data || !Array.isArray(data.items) || !data.items.length) throw new Error(`${file} has no items; fix it or restore it from git`);
  return { version: 1, ...data, items: data.items };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Run one build. Returns { changed, signature, summary, news, health, written, sources } (no process exit).
 * @param {object} options parsed CLI options (see parseArgs) plus optional { env, cwd, log, fetchImpl }
 */
export async function runBuild(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const log = options.quiet ? () => {} : options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const warn = options.quiet ? () => {} : options.warn ?? ((line) => process.stderr.write(`${line}\n`));

  const configPath = resolveFrom(cwd, options.config, 'feeds.json');
  const outDir = resolveFrom(cwd, options.out, 'site');
  const statePath = resolveFrom(cwd, options.state, 'state/state.json');
  const fixturesDir = resolveFrom(cwd, options.fixtures, 'tests/fixtures');
  const templatePath = resolveFrom(cwd, options.template, 'templates/index.html');

  let nowMs;
  if (options.now) {
    nowMs = Date.parse(options.now);
    if (!Number.isFinite(nowMs)) throw new UsageError(`--now is not a valid date: ${options.now}`);
  } else nowMs = Date.now();
  nowMs = Math.floor(nowMs / 1000) * 1000;
  const nowIso = isoSeconds(nowMs);

  let rawConfig;
  try {
    rawConfig = parseJsonLoose(await readFile(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`feeds.json: ${err.code === 'ENOENT' ? `not found at ${configPath}` : `not valid JSON (${err.message})`}`);
  }
  const config = validateConfig(rawConfig);
  const site = resolveSite(config.site, env);
  const sources = config.sources;
  const selection = config.selection;

  const rawState = await readJSON(statePath, null);
  const state = normalizeState(rawState, sources);
  const prevNews = await readJSON(path.join(outDir, 'news.json'), null);
  const prevItems = Array.isArray(prevNews?.items) ? prevNews.items : [];
  // The very first run (5.5): no previous news and no memory. An empty state file ("{}", the RUNBOOK's way to
  // start the memory over) is no memory.
  const firstRun = !prevNews && !(rawState && typeof rawState === 'object' && Object.keys(rawState).length);
  const archiveText = await readText(path.join(outDir, 'archive.json'));
  const archive = parseArchive(archiveText, path.join(outDir, 'archive.json'));
  const template = validateTemplate(await readText(templatePath), templatePath);

  const matcher = compileKeywords(config.keywords, { wiiU: !!config.wiiU });
  const excludes = compileExcludes(config.exclude, (p, err) => warn(`warning: ignoring invalid exclude pattern ${JSON.stringify(p)}: ${err.message}`));

  // firstSeen (5.5): state.seen ?? previous news.json ?? (older than 48 h at discovery ? published : now).
  const prevFirstSeen = new Map(prevItems.filter((i) => i && isIso(i.firstSeen)).map((i) => [i.id, i.firstSeen]));
  const firstSeenFor = (id, publishedMs) => {
    const known = state.seen[id] ?? prevFirstSeen.get(id);
    if (known) return isoSeconds(Date.parse(known));
    if (publishedMs !== null && (firstRun || nowMs - publishedMs > DISCOVERY_GRACE_MS)) return isoSeconds(publishedMs);
    return nowIso;
  };

  // The filter rules and the engine version (section 5.10). When they change, every feed is fetched in
  // full this run (no validators, so no 304 hides an entry the new rules now want), and stories already
  // shown are checked again below.
  const rulesHash = rulesHashOf(config);
  const rulesChanged = rulesHash !== state.rulesHash;
  if (rulesChanged) {
    for (const mem of Object.values(state.sources)) {
      mem.etag = null;
      mem.lastModified = null;
    }
  }
  const rejected = new Set(); // ids of entries this run's feeds still carry but the rules now drop

  const toItems = (entries, src, base) => {
    const out = [];
    for (const raw of entries) {
      const n = normalizeEntry(raw, src, base);
      if (!n) continue;
      const verdict = applyFilter({ title: n.title, text: n.text }, src, { matcher, excludes });
      if (!verdict.keep) {
        rejected.add(itemId(n.url));
        continue;
      }
      const id = itemId(n.url);
      // published: more than 1 h ahead counts as invalid; slightly ahead (clock skew) is clamped to now.
      let published = n.published;
      if (published !== null && published > nowMs + FUTURE_TOLERANCE_MS) published = null;
      else if (published !== null && published > nowMs) published = nowMs;
      const firstSeen = firstSeenFor(id, published);
      if (published === null) published = Date.parse(firstSeen);
      out.push(
        toItem({
          id, title: n.title, url: n.url, source: n.source, sourceId: src.id, via: n.via, tab: src.tab,
          published: isoSeconds(published), firstSeen, excerpt: n.excerpt, matched: verdict.matched,
        }),
      );
    }
    return sortItems(out);
  };

  // Fetch everything (network or fixtures), then process each source.
  const results = await fetchAll(sources, {
    offline: !!options.offline,
    fixturesDir,
    state,
    userAgent: config.userAgent,
    rotate: Math.floor(nowMs / HOUR),
    fetchImpl: options.fetchImpl,
    hostGapMs: options.hostGapMs,
    retryDelayMs: options.retryDelayMs,
  });

  const fresh = [];
  const cached = [];
  const report = [];
  for (const src of sources) {
    const r = results.get(src.id);
    const mem = state.sources[src.id];
    let ok = !!r?.ok;
    let error = r?.error ?? null;
    let parsed = null;
    let items = null;
    if (ok && r.notModified) {
      items = mem.items;
    } else if (ok) {
      const feed = parseFeed(r.text);
      if (feed.format === 'unknown') {
        ok = false;
        error = 'not a feed (unrecognised document)';
      } else {
        parsed = feed.items.length;
        items = toItems(feed.items, src, r.finalUrl);
      }
    }
    mem.lastAttempt = nowIso;
    mem.httpStatus = r?.status ?? null;
    if (ok) {
      mem.etag = r.etag ?? null;
      mem.lastModified = r.lastModified ?? null;
      mem.lastOk = nowIso;
      mem.failures = 0;
      mem.error = null;
      mem.items = items.slice(0, STATE_ITEMS_MAX);
      for (const it of items) fresh.push(it); // a loop, not push(...items): no argument limit
    } else {
      mem.failures += 1;
      mem.error = error || 'fetch failed';
      for (const it of mem.items) cached.push(it);
    }
    const status = ok ? 'ok' : mem.failures >= DOWN_AFTER ? 'down' : 'stale';
    report.push({ src, status, parsed, kept: ok ? items.length : null, cachedCount: ok ? null : mem.items.length, notModified: !!r?.notModified, cp1252: !!r?.charsetFallback, ms: r?.ms ?? null, httpStatus: mem.httpStatus, error: ok ? null : mem.error });
  }

  // After a rules change, a shown or cached story stays only if it would still be kept: one that its feed
  // still carries goes by this run's verdict; an older one from a keyword source must pass on its title, or
  // have matched only keywords that are still configured (its text is no longer at hand).
  let previous = prevItems;
  let cachedKept = cached;
  let recheckDropped = 0;
  if (rulesChanged) {
    const byId = new Map(sources.map((s) => [s.id, s]));
    const keywords = new Set(matcher.order);
    const stillKept = (it) => {
      if (!it || rejected.has(it.id)) return false;
      const src = byId.get(it.sourceId);
      if (!src || (src.filter || 'none') !== 'keywords') return true;
      if (applyFilter({ title: String(it.title ?? ''), text: '' }, src, { matcher, excludes }).keep) return true;
      return Array.isArray(it.matched) && it.matched.length > 0 && it.matched.every((k) => keywords.has(k));
    };
    previous = prevItems.filter(stillKept);
    cachedKept = cached.filter(stillKept);
    // A failing source's cache is reused by the next runs, which see no rules change: clean it now, or a story
    // dropped here would come back an hour later and stay.
    for (const r of report) if (r.status !== 'ok') state.sources[r.src.id].items = state.sources[r.src.id].items.filter(stillKept);
    recheckDropped = prevItems.length - previous.length;
  }

  const sel = selectItems({
    previous,
    cached: cachedKept,
    fresh,
    sources,
    selection,
    excludes,
    now: nowMs,
    prevDolphin: prevNews?.meta?.dolphin ?? null,
  });

  // Memory: every id seen this run keeps its (earliest) firstSeen; other ids are pruned after 45 days.
  const seenNow = new Set();
  const seen = {};
  for (const it of [...fresh, ...cached]) {
    seenNow.add(it.id);
    if (!seen[it.id] || it.firstSeen < seen[it.id]) seen[it.id] = it.firstSeen;
  }
  for (const it of sel.all) {
    seenNow.add(it.id);
    if (!seen[it.id] || it.firstSeen < seen[it.id]) seen[it.id] = it.firstSeen;
  }
  const seenLimit = isoSeconds(nowMs - SEEN_DAYS * DAY);
  for (const [id, fs] of Object.entries(state.seen)) {
    if (seenNow.has(id)) {
      if (fs < seen[id]) seen[id] = fs;
    } else if (fs >= seenLimit) seen[id] = fs;
  }
  state.seen = Object.fromEntries(Object.entries(seen).sort(([a], [b]) => (a < b ? -1 : 1)));

  const shown = new Map();
  for (const it of sel.items) shown.set(it.sourceId, (shown.get(it.sourceId) || 0) + 1);
  const health = {
    version: 1,
    generatedAt: nowIso,
    sources: report.map((r) => ({
      id: r.src.id,
      name: r.src.name,
      tab: r.src.tab,
      homepage: isHttpUrl(r.src.homepage) ? r.src.homepage : null,
      status: r.status,
      lastOk: state.sources[r.src.id].lastOk,
      failures: state.sources[r.src.id].failures,
      items: shown.get(r.src.id) || 0,
      httpStatus: r.httpStatus,
      error: r.error,
      ms: r.ms,
    })),
    summary: { ok: report.filter((r) => r.status === 'ok').length, total: report.length },
  };
  const news = {
    version: 1,
    generatedAt: nowIso,
    items: sel.items,
    meta: { dolphin: sel.dolphin, counts: sel.counts, windowStart: sel.windowStart, completeSince: sel.completeSince },
  };

  // Change detection (5.7). `failing` lists every source that is not OK with its failure count capped
  // at DOWN_AFTER, so each failure step (stale 1, stale 2, down) and the recovery change the signature
  // once. CI commits state/state.json only on changed runs, so without this a failing source's count
  // was thrown away every hour and "down" arrived a day or more late.
  const failing = report
    .filter((r) => r.status !== 'ok')
    .map((r) => [r.src.id, r.status, Math.min(state.sources[r.src.id].failures, DOWN_AFTER)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Where each story sits against the window and the complete part of each view: they place the "Further back"
  // line and decide the quiet phrases (6.2.3), so the page changes when a story crosses one, and only then.
  const side = (i) =>
    (i.published < sel.windowStart ? 1 : 0) | (i.published >= sel.completeSince.all ? 2 : 0) | (i.published >= sel.completeSince[i.tab] ? 4 : 0);
  const signature = sha256Hex(
    stableJSON({
      items: sel.items.map((i) => [i.id, i.title, i.url, i.source, i.published, i.excerpt, i.tab, side(i)]),
      failing,
      archive: archiveText === null ? null : sha256Hex(archiveText),
      day: utcDay(nowMs),
      rules: rulesHash,
    }),
  );
  const changed = !!options.force || signature !== state.signature;

  const written = [];
  if (changed) {
    const html = renderPage({ template, news, archive, health, site, now: new Date(nowMs) });
    const outputs = [
      ['index.html', html],
      ['news.json', `${JSON.stringify(news, null, 2)}\n`],
      ['feed.xml', renderRss({ site, items: news.items, sources, generatedAt: nowIso })],
      ['feed.json', renderJsonFeed({ site, items: news.items })],
      ['health.json', `${JSON.stringify(health, null, 2)}\n`],
    ];
    for (const [name, content] of outputs) {
      await atomicWrite(path.join(outDir, name), content);
      written.push(name);
    }
    state.signature = signature;
    state.lastWrite = nowIso;
  }
  const stateOut = { version: 1, signature: state.signature, rulesHash, lastWrite: state.lastWrite, seen: state.seen, sources: state.sources };
  await atomicWrite(statePath, `${JSON.stringify(stateOut, null, 2)}\n`);

  // Logging (5.9).
  for (const r of report) {
    const http = r.httpStatus ?? '-';
    const ms = r.ms === null ? '-' : `${r.ms}ms`;
    let detail;
    if (r.status === 'ok' && r.notModified) detail = `not modified, ${r.kept} cached`;
    else if (r.status === 'ok') detail = `${lpad(r.parsed, 3)} parsed  ${lpad(r.kept, 3)} kept${r.cp1252 ? ' (not UTF-8: read as windows-1252)' : ''}`;
    else detail = `${r.error}; using ${r.cachedCount} cached`;
    log(`${pad(r.status, 6)}${pad(r.src.id, 18)}${lpad(http, 4)}  ${lpad(ms, 7)}  ${detail}  ${lpad(shown.get(r.src.id) || 0, 3)} shown`);
  }
  const fresher = news.items.filter((i) => i.firstSeen >= nowIso).length;
  const okCount = report.filter((r) => r.status === 'ok').length;
  const summary =
    `${news.items.length} items (press ${sel.counts.press}, scene ${sel.counts.scene}), ${fresher} new; ` +
    `${okCount} of ${report.length} sources ok` +
    (report.some((r) => r.status === 'stale') ? `, ${report.filter((r) => r.status === 'stale').length} stale` : '') +
    (report.some((r) => r.status === 'down') ? `, ${report.filter((r) => r.status === 'down').length} down` : '') +
    `; ${changed ? (options.force && signature === rawState?.signature ? 'forced write' : 'changed') : 'unchanged'}` +
    (rulesChanged && rawState ? `; filter rules or engine changed: every feed fetched in full, ${recheckDropped} shown ${recheckDropped === 1 ? 'story' : 'stories'} dropped` : '');
  log(summary);

  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `changed=${changed}\nsummary=${summary.replace(/[\r\n]+/g, ' ')}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = report.map((r) => {
      const note = r.status === 'ok' ? (r.notModified ? 'not modified' : '') : `${r.error}; ${r.cachedCount} cached`;
      return `| ${mdCell(r.src.name)} | ${r.status} | ${r.httpStatus ?? '-'} | ${r.ms ?? '-'} | ${r.parsed ?? '-'} | ${r.kept ?? '-'} | ${shown.get(r.src.id) || 0} | ${mdCell(note)} |`;
    });
    const md = [
      '### WiiVolve build',
      '',
      `${summary}`,
      '',
      '| Source | Status | HTTP | ms | Parsed | Kept | Shown | Note |',
      '|---|---|---|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');
    await appendFile(env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }

  return { changed, signature, summary, news, health, written, sources: report.map((r) => ({ id: r.src.id, status: r.status })) };
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    await runBuild(opts);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      return 2;
    }
    process.stderr.write(`build-news: ${err?.stack || err}\n`);
    return 1;
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = await main();
