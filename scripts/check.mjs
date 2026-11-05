#!/usr/bin/env node
// Weekly self-check of the live site. Contract: docs/ARCHITECTURE.md section 9; docs/RUNBOOK.md.
//
//   node scripts/check.mjs [--url https://wiivolve.com] [--report-only]
//
// Checks
//   1. the live page answers 200 with HTML
//   2. /health.json parses and its generatedAt is younger than 26 hours
//   3. no source in health.json has been "down" for more than 7 days
//   4. every web.archive.org link on the live page answers (deduplicated, one request at a time
//      with a pause, retried); if web.archive.org itself is unreachable that is a note, not a problem
//   5. /feed.xml is well-formed RSS 2.0 and /feed.json is a JSON Feed
//
// With GH_TOKEN and GITHUB_REPOSITORY set (the scheduled GitHub Actions job), the result goes to one
// GitHub issue labelled "site-check": opened when problems appear, commented on each week while they
// last, closed with a note once everything passes. The exit code is then 0 unless GitHub itself
// fails, because the issue is the notification. Otherwise, or with --report-only, the report is
// printed and the exit code is 1 when there are problems.
//
// Site URL: --url, else $SITE_URL, else feeds.json site.url, else https://wiivolve.com.
// Self-contained on purpose: Node >= 22 built-ins only, nothing from scripts/lib.

import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_SITE_URL = 'https://wiivolve.com';
export const LABEL = 'site-check';
export const HEALTH_MAX_AGE_HOURS = 26;
export const SOURCE_DOWN_DAYS = 7;
export const ARCHIVE_HOST = 'web.archive.org';
const ARCHIVE_PROBE_URL = 'https://web.archive.org/';
const USER_AGENT = 'Mozilla/5.0 (compatible; WiiVolveCheck/1.0; +https://wiivolve.com/)';
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Configuration

/**
 * Removes // and /* *\/ comments and trailing commas outside strings, so a JSONC-style feeds.json still loads.
 * The same single scan as parseJsonLoose in scripts/lib/util.mjs (kept here because this script is self-contained).
 */
export function parseJsonLoose(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(src);
  } catch {
    // Not plain JSON: strip comments and trailing commas, then parse again.
  }
  // Index of the next character after whitespace and comments, starting at i.
  const skip = (i) => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (src[i] === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 2;
      } else return i;
    }
  };
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      out += ' ';
      i = skip(i) - 1;
    } else if (c === ',' && (src[skip(i + 1)] === '}' || src[skip(i + 1)] === ']')) {
      // A trailing comma: dropped.
    } else out += c;
  }
  return JSON.parse(out);
}

/** Origin plus path without a trailing slash, or null when not an http(s) URL. */
export function normalizeSiteUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

/** --url, then $SITE_URL, then feeds.json site.url, then https://wiivolve.com. */
export async function resolveSiteUrl({ argv = [], env = {}, configPath = path.join(ROOT, 'feeds.json') } = {}) {
  for (const candidate of [argValue(argv, '--url'), env.SITE_URL]) {
    const url = normalizeSiteUrl(candidate);
    if (url) return url;
  }
  try {
    const config = parseJsonLoose(await readFile(configPath, 'utf8'));
    const url = normalizeSiteUrl(config?.site?.url);
    if (url) return url;
  } catch {
    // feeds.json missing or unreadable: use the default
  }
  return DEFAULT_SITE_URL;
}

// ---------------------------------------------------------------------------------------------
// Parsing helpers (pure)

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Every distinct web.archive.org link in href attributes, as https URLs without fragments, in page order. */
export function extractArchiveLinks(html) {
  const found = new Set();
  const re = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const m of html.matchAll(re)) {
    const raw = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname !== ARCHIVE_HOST) continue;
    u.protocol = 'https:';
    u.hash = '';
    found.add(u.href);
  }
  return [...found];
}

const XML_NAME = /^[A-Za-z_][-A-Za-z0-9_.:]*$/;
const XML_ATTRIBUTE = /^\s+([A-Za-z_][-A-Za-z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const XML_ILLEGAL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function xmlTextError(text) {
  for (const m of text.matchAll(/&([^;&\s<]*)(;?)/g)) {
    const [, ref, semi] = m;
    if (!semi) return 'unescaped "&"';
    if (ref[0] === '#') {
      const hex = ref[1] === 'x';
      const digits = ref.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) return `bad character reference &${ref};`;
      const cp = parseInt(digits, hex ? 16 : 10);
      const legal = cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
      if (!legal) return `illegal character reference &${ref};`;
    } else if (!['amp', 'lt', 'gt', 'quot', 'apos'].includes(ref)) {
      return `undefined entity &${ref};`;
    }
  }
  return null;
}

/**
 * A small, strict XML well-formedness check (no DTD support beyond skipping a DOCTYPE).
 * Returns { error, root, counts } where counts maps element names to how often they start.
 */
export function checkXml(input) {
  const counts = new Map();
  const fail = (error) => ({ error, root: null, counts });
  if (typeof input !== 'string' || !input.trim()) return fail('empty document');
  const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (XML_ILLEGAL_CHAR.test(s)) return fail('illegal control character');
  const stack = [];
  let root = null;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = s.slice(i, lt === -1 ? s.length : lt);
    if (text) {
      if (!stack.length) {
        if (text.trim()) return fail(root ? 'text after the root element' : 'text before the root element');
      } else {
        const bad = xmlTextError(text);
        if (bad) return fail(`${bad} inside <${stack.at(-1)}>`);
      }
    }
    if (lt === -1) break;
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) return fail('unclosed comment');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      if (!stack.length) return fail('CDATA section outside the root element');
      const end = s.indexOf(']]>', lt + 9);
      if (end === -1) return fail('unclosed CDATA section');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      if (end === -1) return fail('unclosed processing instruction');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!', lt)) {
      if (root) return fail('declaration after the root element');
      const end = s.indexOf('>', lt + 2);
      if (end === -1) return fail('unclosed declaration');
      i = end + 1;
      continue;
    }
    let j = lt + 1;
    let quote = '';
    for (; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = '';
        else if (c === '<') return fail('"<" inside an attribute value');
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      else if (c === '<') return fail('"<" inside a tag');
    }
    if (j >= s.length) return fail('unclosed tag');
    const inner = s.slice(lt + 1, j);
    i = j + 1;
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const open = stack.pop();
      if (!open) return fail(`</${name}> without an opening tag`);
      if (open !== name) return fail(`</${name}> closes <${open}>`);
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = /^([^\s]+)([\s\S]*)$/.exec(body);
    if (!m || !XML_NAME.test(m[1])) return fail(`bad tag <${body.slice(0, 30)}>`);
    const name = m[1];
    let rest = m[2];
    const seen = new Set();
    while (rest.trim()) {
      const a = XML_ATTRIBUTE.exec(rest);
      if (!a) return fail(`bad attribute in <${name}>`);
      if (seen.has(a[1])) return fail(`duplicate attribute "${a[1]}" in <${name}>`);
      seen.add(a[1]);
      const bad = xmlTextError(a[2] ?? a[3]);
      if (bad) return fail(`${bad} in an attribute of <${name}>`);
      rest = rest.slice(a[0].length);
    }
    if (!stack.length) {
      if (root) return fail('more than one root element');
      root = name;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
    if (!selfClosing) stack.push(name);
  }
  if (stack.length) return fail(`<${stack.at(-1)}> is never closed`);
  if (!root) return fail('no root element');
  return { error: null, root, counts };
}

/** RSS 2.0 as written by the builder: well-formed, root <rss version="2.0">, one <channel>. */
export function checkRss(text) {
  const xml = checkXml(text);
  if (xml.error) return { error: xml.error, items: 0 };
  if (xml.root !== 'rss') return { error: `root element is <${xml.root}>, not <rss>`, items: 0 };
  if (!/<rss\b[^>]*\bversion\s*=\s*["']2\.0["']/.test(text)) return { error: 'missing version="2.0" on <rss>', items: 0 };
  if (!xml.counts.get('channel')) return { error: 'no <channel> element', items: 0 };
  return { error: null, items: xml.counts.get('item') || 0 };
}

/** JSON Feed 1.x: an object with version, title and an items array whose entries have ids. */
export function checkJsonFeed(text) {
  let feed;
  try {
    feed = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON (${err.message})`, items: 0 };
  }
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) return { error: 'not a JSON object', items: 0 };
  if (typeof feed.version !== 'string' || !feed.version.startsWith('https://jsonfeed.org/version/1')) {
    return { error: 'missing or unknown "version"', items: 0 };
  }
  if (typeof feed.title !== 'string') return { error: 'missing "title"', items: 0 };
  if (!Array.isArray(feed.items)) return { error: '"items" is not an array', items: 0 };
  const bad = feed.items.findIndex((it) => !it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id);
  if (bad >= 0) return { error: `item ${bad + 1} has no "id"`, items: feed.items.length };
  return { error: null, items: feed.items.length };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatAge(ms) {
  const hours = ms / HOUR;
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return plural(Math.round(hours), 'hour');
  return plural(Math.round(ms / DAY), 'day');
}

/** Problems and notes from a parsed health.json (section 4.4) at time `now`. */
export function evaluateHealth(health, now) {
  const problems = [];
  const notes = [];
  const generated = Date.parse(health?.generatedAt);
  let age = null;
  if (Number.isNaN(generated)) {
    problems.push('health.json has no valid "generatedAt", so the build output on the live site cannot be dated.');
  } else {
    age = now.getTime() - generated;
    if (age > HEALTH_MAX_AGE_HOURS * HOUR) {
      problems.push(
        `health.json is ${formatAge(age)} old (generated ${health.generatedAt}). The hourly build has not ` +
          'deployed for more than a day: look at the latest runs on the Actions tab.',
      );
    }
  }
  const sources = Array.isArray(health?.sources) ? health.sources : [];
  if (!Array.isArray(health?.sources)) problems.push('health.json has no "sources" list.');
  let down = 0;
  let longDown = 0;
  for (const s of sources) {
    if (s?.status !== 'down') continue;
    down++;
    const label = s.name && s.id && s.name !== s.id ? `${s.name} (${s.id})` : s.name || s.id || 'a source';
    const lastOk = Date.parse(s.lastOk);
    const error = s.error ? `; last error: ${s.error}` : s.httpStatus ? `; last answer: HTTP ${s.httpStatus}` : '';
    if (Number.isNaN(lastOk)) {
      longDown++;
      problems.push(`${label} is down and has never fetched successfully${error}. Fix or remove its entry in feeds.json.`);
    } else if (now.getTime() - lastOk > SOURCE_DOWN_DAYS * DAY) {
      longDown++;
      problems.push(
        `${label} has been down for ${formatAge(now.getTime() - lastOk)} (last OK ${s.lastOk}${error}). ` +
          'Fix or remove its entry in feeds.json.',
      );
    } else {
      notes.push(`${label} is down (last OK ${s.lastOk}). It is reported only after ${SOURCE_DOWN_DAYS} days.`);
    }
  }
  return { problems, notes, age, total: sources.length, down, longDown };
}

// ---------------------------------------------------------------------------------------------
// Network

function retryAfterMs(res, cap = 60e3) {
  const value = res?.headers?.get?.('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Math.min(Math.max(ms || 0, 0), cap);
}

async function discardBody(res) {
  try {
    await res?.body?.cancel?.();
  } catch {
    // already consumed or not a stream
  }
}

/** fetch with a timeout and retries on network errors, 429 and 5xx. Returns { res } or { error }. */
async function request(fetchFn, url, { sleep, tries = 3, backoff = [2000, 6000], timeoutMs = 20e3, retryAfterCap = 60e3, headers = {} } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (attempt > 1) {
      const base = backoff[Math.min(attempt - 2, backoff.length - 1)];
      await sleep(Math.max(base, retryAfterMs(last?.res, retryAfterCap)));
    }
    if (last?.res) await discardBody(last.res);
    try {
      const res = await fetchFn(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      last = { res };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (error) {
      last = { error };
    }
  }
  return last;
}

const describe = (result) =>
  result.error ? result.error.cause?.code || result.error.name || String(result.error.message || result.error) : `HTTP ${result.res.status}`;

/** A broken snapshot (404, 410, ...) as opposed to Wayback being busy or blocking us (403, 429, 5xx). */
const brokenStatus = (status) => status >= 400 && status < 500 && ![401, 403, 407, 408, 425, 429].includes(status);

async function getText(fetchFn, url, opts) {
  const result = await request(fetchFn, url, opts);
  if (result.error || !result.res.ok) return { ...result, text: null };
  try {
    return { ...result, text: await result.res.text() };
  } catch (error) {
    return { error, text: null };
  }
}

// ---------------------------------------------------------------------------------------------
// The checks

/**
 * Runs every check. Never throws for network trouble; that is reported.
 * Options: siteUrl, fetch, now (Date), sleep(ms), clock() (ms, for the time budget), archivePauseMs,
 * archiveBackoff, archiveBudgetMs, archiveRecheckMs, siteBackoff.
 *
 * The archive links share one time budget (8 minutes), so a slow or rate-limiting Wayback Machine can never
 * push the job past its timeout (which would update no issue at all): links left over when the budget is
 * used, or after three links in a row could not be verified, are listed as unverified, which is a note. A link
 * that answers 404 or 410 is asked again once at the end, a minute later, before it counts as broken.
 */
export async function runChecks({
  siteUrl = DEFAULT_SITE_URL,
  fetch: fetchFn = globalThis.fetch,
  now = new Date(),
  sleep = realSleep,
  clock = Date.now,
  archivePauseMs = 2500,
  archiveBackoff = [5000, 15000],
  archiveBudgetMs = 8 * 60e3,
  archiveRecheckMs = 60e3,
  siteBackoff = [2000, 6000],
} = {}) {
  const report = { siteUrl, checkedAt: now.toISOString(), problems: [], notes: [], checks: [] };
  const add = (name, status, detail) => report.checks.push({ name, status, detail });
  const siteOpts = { sleep, backoff: siteBackoff };

  // 1. The live page.
  const home = await getText(fetchFn, `${siteUrl}/`, { ...siteOpts, headers: { Accept: 'text/html' } });
  let html = null;
  if (home.text === null) {
    report.problems.push(`The live site did not answer properly (${describe(home)} for ${siteUrl}/).`);
    add('Live page', 'problem', describe(home));
  } else if (!/<html[\s>]/i.test(home.text)) {
    report.problems.push(`${siteUrl}/ answered, but not with an HTML page.`);
    add('Live page', 'problem', 'not HTML');
  } else {
    html = home.text;
    add('Live page', 'ok', `HTTP ${home.res.status}, ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
  }

  // 2 and 3. health.json: freshness and sources.
  const healthRes = await getText(fetchFn, `${siteUrl}/health.json`, { ...siteOpts, headers: { Accept: 'application/json' } });
  if (healthRes.text === null) {
    report.problems.push(`${siteUrl}/health.json did not load (${describe(healthRes)}).`);
    add('health.json', 'problem', describe(healthRes));
    add('Sources', 'problem', 'unknown (no health.json)');
  } else {
    let health = null;
    try {
      health = JSON.parse(healthRes.text);
    } catch {
      report.problems.push(`${siteUrl}/health.json is not valid JSON.`);
      add('health.json', 'problem', 'not JSON');
      add('Sources', 'problem', 'unknown (no health.json)');
    }
    if (health) {
      const h = evaluateHealth(health, now);
      report.problems.push(...h.problems);
      report.notes.push(...h.notes);
      const fresh = h.age !== null && h.age <= HEALTH_MAX_AGE_HOURS * HOUR;
      add('health.json', fresh ? 'ok' : 'problem', h.age === null ? 'no valid generatedAt' : `generated ${formatAge(h.age)} ago`);
      const sourcesDetail = !h.down
        ? `${plural(h.total, 'source')}, none down`
        : h.longDown
          ? `${plural(h.total, 'source')}, ${h.longDown} down for more than ${SOURCE_DOWN_DAYS} days`
          : `${plural(h.total, 'source')}, ${h.down} down for less than ${SOURCE_DOWN_DAYS} days`;
      add('Sources', h.longDown ? 'problem' : h.down ? 'note' : 'ok', sourcesDetail);
    }
  }

  // 4. web.archive.org links on the live page.
  if (html === null) {
    report.notes.push('Archive links were not checked because the live page did not load.');
    add('Archive links', 'note', 'not checked');
  } else {
    const links = extractArchiveLinks(html);
    if (!links.length) {
      report.notes.push('The live page has no web.archive.org links (the archive section may be missing).');
      add('Archive links', 'note', 'none found');
    } else {
      const probe = await request(fetchFn, ARCHIVE_PROBE_URL, { sleep, backoff: archiveBackoff });
      const reachable = !probe.error && probe.res.status < 500 && probe.res.status !== 429 && probe.res.status !== 403;
      if (probe.res) await discardBody(probe.res);
      if (!reachable) {
        report.notes.push(
          `web.archive.org did not answer (${describe(probe)}), so the ${links.length} archive links were not checked this week.`,
        );
        add('Archive links', 'note', `not checked, web.archive.org unreachable (${describe(probe)})`);
      } else {
        let ok = 0;
        let broken = 0;
        const unverified = [];
        const suspects = [];
        const stopAt = clock() + archiveBudgetMs;
        const archiveOpts = { sleep, backoff: archiveBackoff, tries: 2, timeoutMs: 20e3, retryAfterCap: 20e3 };
        let inARow = 0;
        let gaveUp = null;
        for (const link of links) {
          if (gaveUp) {
            unverified.push(`${link} (not checked: ${gaveUp})`);
            continue;
          }
          if (clock() >= stopAt) {
            gaveUp = 'time budget used';
            unverified.push(`${link} (not checked: ${gaveUp})`);
            continue;
          }
          await sleep(archivePauseMs);
          const result = await request(fetchFn, link, archiveOpts);
          if (result.res) await discardBody(result.res);
          if (!result.error && result.res.ok) {
            ok++;
            inARow = 0;
          } else if (!result.error && brokenStatus(result.res.status)) {
            suspects.push({ link, status: result.res.status });
            inARow = 0;
          } else {
            unverified.push(`${link} (${describe(result)})`);
            inARow++;
            if (inARow >= 3) gaveUp = 'web.archive.org stopped answering three links in a row';
          }
        }
        // A 404 from Wayback is sometimes a passing hiccup: ask once more, a minute later. A link counts as
        // broken only after both answers; with no time left for the second ask it is unverified (a note).
        const recheck = suspects.length > 0 && clock() + archiveRecheckMs < stopAt;
        if (recheck) await sleep(archiveRecheckMs);
        for (const { link, status } of suspects) {
          const again = recheck && clock() < stopAt ? await request(fetchFn, link, { ...archiveOpts, tries: 1 }) : null;
          if (again?.res) await discardBody(again.res);
          if (!again) unverified.push(`${link} (HTTP ${status} once; no time left to ask again)`);
          else if (!again.error && again.res.ok) ok++;
          else if (again.error || !brokenStatus(again.res.status)) unverified.push(`${link} (${describe(again)})`);
          else {
            broken++;
            report.problems.push(`Archive link is broken (HTTP ${again.res.status}, twice a minute apart): ${link}. Update or remove it in site/archive.json or the About panel.`);
          }
        }
        if (unverified.length) {
          report.notes.push(
            `${unverified.length} archive link${unverified.length === 1 ? '' : 's'} could not be verified because ` +
              `web.archive.org was slow or busy${gaveUp ? ` (${gaveUp})` : ''}: ${unverified.join(', ')}.`,
          );
        }
        add('Archive links', broken ? 'problem' : unverified.length ? 'note' : 'ok', `${ok} of ${links.length} OK` +
          (broken ? `, ${broken} broken` : '') + (unverified.length ? `, ${unverified.length} unverified` : ''));
      }
    }
  }

  // 5. Both feeds.
  const feeds = [
    ['feed.xml', checkRss, 'application/rss+xml, application/xml;q=0.9, */*;q=0.5'],
    ['feed.json', checkJsonFeed, 'application/feed+json, application/json;q=0.9, */*;q=0.5'],
  ];
  for (const [file, check, accept] of feeds) {
    const res = await getText(fetchFn, `${siteUrl}/${file}`, { ...siteOpts, headers: { Accept: accept } });
    if (res.text === null) {
      report.problems.push(`${siteUrl}/${file} did not load (${describe(res)}).`);
      add(file, 'problem', describe(res));
      continue;
    }
    const result = check(res.text);
    if (result.error) {
      report.problems.push(`${file} does not parse: ${result.error}.`);
      add(file, 'problem', result.error);
    } else {
      add(file, 'ok', `${result.items} item${result.items === 1 ? '' : 's'}`);
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// Report

const STATUS_WORD = { ok: 'OK', note: 'Note', problem: 'Problem' };

export function formatReport(report, { repo = null } = {}) {
  const when = report.checkedAt.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC');
  const lines = [`### WiiVolve site check, ${when}`, '', `Checked ${report.siteUrl}.`, ''];
  if (report.problems.length) {
    const n = report.problems.length;
    lines.push(`**${n} problem${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a human:**`, '');
    report.problems.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  } else {
    lines.push('**All clear.** Every check passed.');
  }
  if (report.notes.length) {
    lines.push('', 'Notes (no action needed):', '');
    for (const note of report.notes) lines.push(`- ${note}`);
  }
  lines.push('', '| Check | Result | Details |', '| --- | --- | --- |');
  for (const c of report.checks) lines.push(`| ${c.name} | ${STATUS_WORD[c.status] || c.status} | ${String(c.detail).replace(/\|/g, '\\|')} |`);
  const runbook = repo ? `[docs/RUNBOOK.md](https://github.com/${repo}/blob/main/docs/RUNBOOK.md#troubleshooting)` : 'docs/RUNBOOK.md';
  lines.push('', `Troubleshooting: ${runbook}.`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// GitHub issue

async function github(fetchFn, { apiUrl, token }, method, route, body) {
  const res = await fetchFn(`${apiUrl}${route}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wiivolve-site-check',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30e3),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

function ghFail(what, r) {
  const message = r.data && typeof r.data === 'object' && r.data.message ? `: ${r.data.message}` : '';
  return new Error(`GitHub ${what} failed with HTTP ${r.status}${message}`);
}

/**
 * Keeps exactly one open issue labelled site-check in step with the report.
 * Returns { action: 'created' | 'commented' | 'closed' | 'none', number }.
 */
export async function syncIssue({ report, fetch: fetchFn = globalThis.fetch, token, repo, apiUrl = 'https://api.github.com', now = new Date() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error(`GITHUB_REPOSITORY "${repo}" is not owner/name`);
  const gh = (method, route, body) => github(fetchFn, { apiUrl: apiUrl.replace(/\/+$/, ''), token }, method, route, body);
  const base = `/repos/${repo}`;

  const label = await gh('GET', `${base}/labels/${LABEL}`);
  if (label.status === 404) {
    const created = await gh('POST', `${base}/labels`, {
      name: LABEL,
      color: '2f7df6',
      description: 'Opened and closed by the weekly self-check (scripts/check.mjs)',
    });
    if (!created.ok && created.status !== 422) throw ghFail('creating the label', created);
  } else if (!label.ok) throw ghFail('reading the label', label);

  const list = await gh('GET', `${base}/issues?state=open&labels=${LABEL}&per_page=100`);
  if (!list.ok) throw ghFail('listing issues', list);
  const open = (Array.isArray(list.data) ? list.data : [])
    .filter((it) => it && !it.pull_request)
    .sort((a, b) => a.number - b.number)[0];
  const body = formatReport(report, { repo });
  const day = now.toISOString().slice(0, 10);

  if (report.problems.length) {
    if (open) {
      const r = await gh('POST', `${base}/issues/${open.number}/comments`, { body });
      if (!r.ok) throw ghFail('commenting', r);
      return { action: 'commented', number: open.number };
    }
    const n = report.problems.length;
    const r = await gh('POST', `${base}/issues`, {
      title: `Site check: ${n} problem${n === 1 ? '' : 's'} (${day})`,
      body: `${body}\nThis issue gets a comment every Monday while problems last and closes itself once every check passes.\n`,
      labels: [LABEL],
    });
    if (!r.ok) throw ghFail('opening the issue', r);
    return { action: 'created', number: r.data?.number ?? null };
  }
  if (open) {
    const r = await gh('POST', `${base}/issues/${open.number}/comments`, { body: `All clear on ${day}. Closing.\n\n${body}` });
    if (!r.ok) throw ghFail('commenting', r);
    const closed = await gh('PATCH', `${base}/issues/${open.number}`, { state: 'closed', state_reason: 'completed' });
    if (!closed.ok) throw ghFail('closing the issue', closed);
    return { action: 'closed', number: open.number };
  }
  return { action: 'none', number: null };
}

// ---------------------------------------------------------------------------------------------
// CLI

/** Returns the exit code. Everything external is injectable for tests. */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetch: fetchFn = globalThis.fetch,
  now = new Date(),
  sleep = realSleep,
  out = (line) => process.stdout.write(`${line}\n`),
  configPath = path.join(ROOT, 'feeds.json'),
  checkOptions = {},
} = {}) {
  const siteUrl = await resolveSiteUrl({ argv, env, configPath });
  const report = await runChecks({ siteUrl, fetch: fetchFn, now, sleep, ...checkOptions });
  const repo = env.GITHUB_REPOSITORY || null;
  const text = formatReport(report, { repo });
  out(text);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      await appendFile(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    } catch {
      // the summary is a nicety
    }
  }

  const reportOnly = argv.includes('--report-only');
  if (!reportOnly && env.GH_TOKEN && repo) {
    try {
      const result = await syncIssue({ report, fetch: fetchFn, token: env.GH_TOKEN, repo, apiUrl: env.GITHUB_API_URL || undefined, now });
      const what = { created: 'Opened issue', commented: 'Commented on issue', closed: 'Closed issue', none: 'No issue needed' }[result.action];
      out(`${what}${result.number ? ` #${result.number}` : ''}.`);
      return 0;
    } catch (err) {
      out(`Could not update the GitHub issue: ${err.message}`);
      return 1;
    }
  }
  if (env.GH_TOKEN && !repo && !reportOnly) out('GH_TOKEN is set but GITHUB_REPOSITORY is not, so no issue was filed.');
  return report.problems.length ? 1 : 0;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err?.stack || err);
      process.exitCode = 1;
    },
  );
}
