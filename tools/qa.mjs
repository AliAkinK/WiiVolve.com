#!/usr/bin/env node
// QA for a built site directory: static contract checks + the standard screenshot set.
//
//   node tools/qa.mjs [dir=site] [shotsDir=work/shots] [--only name,name] [--no-shots]
//
// Static checks follow docs/ARCHITECTURE.md (required hooks, CSP-safe markup, head tags, budgets). Every shot
// must also load without a JS error, a CSP violation or a failed request, and some shots check one behaviour
// (their `check`). Requests to web.archive.org are answered by a stub, so QA never loads the Wayback
// Machine: the legacy shots check where the bounce would go. Writes <shotsDir>/report.json and prints a
// short summary. Exit code 1 when any check fails.

import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';
import { shootAll } from './shoot.mjs';

// Raw and gzip budgets per file (docs/ARCHITECTURE.md section 8). Gzip is what visitors download;
// the raw caps keep the source small enough to read and review.
export const BUDGETS = {
  html: { raw: 64 * 1024, gzip: 16 * 1024 },
  css: { raw: 24 * 1024, gzip: 8 * 1024 },
  js: { raw: 16 * 1024, gzip: 6 * 1024 },
};

const OFFLINE = ['web.archive.org'];

/**
 * Old-link checks: where /<endpoint>?<param>=N should end (docs/ARCHITECTURE.md 7.4): its capture from
 * site/legacy-map.json, else the endpoint's list page there ("_list"), else the 2008 form.
 */
export function legacyTarget(map, id, spelled = `fullNews.php?newsId=${id}`, key = `fullnews.php?newsid=${id}`) {
  if (map[key]) return { url: map[key], via: 'legacy-map.json' };
  const list = map._list?.[key.split('?')[0]];
  return list ? { url: list, via: 'its list page in legacy-map.json' } : { url: `https://web.archive.org/web/2008/http://wiivolve.com/${spelled}`, via: 'the 2008 fallback' };
}

// The quiet phrases and the "Further back" line for what is visible (6.2.3, D9): a phrase only on a group whose
// first visible story carries it for this view (data-qa in All, data-qt in a tab), none in a search, none below
// the window; the line right before the first visible story older than the window, and visible.
const VIEWS = `(() => {
  const w = Date.parse(document.getElementById('stream').dataset.window), tab = document.documentElement.dataset.tab;
  const searching = document.documentElement.classList.contains('searching'), bad = [];
  const vis = [...document.querySelectorAll('#stream [data-item]')].filter((e) => e.offsetParent);
  for (const g of document.querySelectorAll('#stream .grp')) {
    const first = [...g.querySelectorAll('[data-item]')].find((e) => e.offsetParent), q = g.querySelector('.quiet');
    if (!first) continue;
    const want = searching ? '' : first.dataset[tab === 'all' ? 'qa' : 'qt'] || '';
    if ((q ? q.textContent : '') !== want) bad.push('phrase ' + JSON.stringify(q && q.textContent) + ', expected ' + JSON.stringify(want));
    if (q && Date.parse(first.dataset.published) < w) bad.push('phrase below the window');
  }
  const old = vis.find((e) => Date.parse(e.dataset.published) < w), m = document.querySelector('#stream .further');
  if (old && !(m && m.offsetParent && m.parentNode === old.closest('.grp') && [...m.parentNode.querySelectorAll('[data-item]')].find((e) => e.offsetParent) === old)) bad.push('"Further back" not before the first older story');
  if (!old && m && m.offsetParent) bad.push('"Further back" with no older story');
  return { phrases: document.querySelectorAll('#stream .quiet').length, further: !!old, bad };
})()`;
const views = (r) => (r.evalResult?.bad?.length === 0 ? null : `quiet phrases or "Further back" out of place: ${JSON.stringify(r.evalResult)}`);

export function standardShots(now = new Date(), { legacyMap = {} } = {}) {
  const sixHoursAgo = new Date(now.getTime() - 6 * 3600e3).toISOString();
  const bounce = (id, spelled, key) => {
    const want = legacyTarget(legacyMap, id, undefined, key);
    return (r) => (r.evalResult === want.url ? null : `ended at ${r.evalResult || 'unknown'}, expected ${want.url} (${want.via}) for ${spelled}`);
  };
  return [
    { name: 'desktop-light', eval: VIEWS, check: views },
    { name: 'desktop-dark', dark: true },
    { name: 'desktop-full-light', full: true, maxHeight: 9000 },
    { name: 'desktop-full-dark', full: true, dark: true, maxHeight: 9000 },
    { name: 'mobile-light', mobile: true },
    { name: 'mobile-dark', mobile: true, dark: true },
    { name: 'mobile-full-light', mobile: true, full: true, maxHeight: 16000 },
    { name: 'returning-visitor', storage: { 'wiivolve:lastVisit': sixHoursAgo } },
    { name: 'returning-visitor-mobile-dark', mobile: true, dark: true, storage: { 'wiivolve:lastVisit': sixHoursAgo } },
    { name: 'search-dolphin', path: '/?q=dolphin', eval: VIEWS, check: views },
    { name: 'search-no-results', path: '/?q=zzzzzz' },
    { name: 'filter-press', path: '/?tab=press', eval: VIEWS, check: views },
    { name: 'deep-end-light', scroll: '#deep-end' },
    { name: 'deep-end-mobile-dark', mobile: true, dark: true, scroll: '#deep-end' },
    { name: 'about-open', eval: "document.getElementById('about')?.showPopover?.(); true" },
    { name: 'birthday', path: '/?now=2026-11-19T15:00:00Z' },
    { name: 'no-js', nojs: true },
    { name: 'no-js-deep-end', nojs: true, scroll: '#deep-end' },
    { name: 'reduced-motion', reducedMotion: true, storage: { 'wiivolve:lastVisit': sixHoursAgo } },
    { name: 'print', width: 900, height: 1200, print: true, full: true, maxHeight: 7000 },
    { name: '404', path: '/no-such-page' },
    { name: 'legacy-bounce', path: '/fullNews.php?newsId=12', wait: 2500, eval: 'location.href', noImage: true, stub: OFFLINE, check: bounce(12, '/fullNews.php?newsId=12') },
    // Added after the 2026-11-04 review: each one guards a bug that shipped once.
    { name: 'legacy-bounce-mapped', path: '/FullNews.php/?NEWSID=213&page=1', wait: 2500, eval: 'location.href', noImage: true, stub: OFFLINE, check: bounce(213, '/FullNews.php/?NEWSID=213&page=1') },
    { name: 'legacy-bounce-game', path: '/GameInfo.php?gameId=5', wait: 2500, eval: 'location.href', noImage: true, stub: OFFLINE, check: bounce(5, '/GameInfo.php?gameId=5', 'gameinfo.php?gameid=5') },
    { name: '404-no-js-mobile-320', path: '/fullNews.php?newsId=213', nojs: true, mobile: true, width: 320, height: 700, eval: '[document.documentElement.scrollWidth, innerWidth, document.querySelectorAll(".alt a").length]', check: (r) => (r.evalResult?.[0] > r.evalResult?.[1] ? `scrolls sideways (${r.evalResult[0]} > ${r.evalResult[1]} px)` : r.evalResult?.[2] < 2 ? 'no way into the archive without JS' : null) },
    { name: 'search-wii', path: '/?q=wii', eval: '({ shares: document.querySelectorAll(".share").length, live: document.querySelectorAll("#stream [data-item]").length, settled: document.documentElement.classList.contains("settled"), console: !document.getElementById("console").disabled })', check: (r) => (r.evalResult && r.evalResult.shares === r.evalResult.live && r.evalResult.settled && r.evalResult.console ? null : `app.js did not finish: ${JSON.stringify(r.evalResult)}`) },
    { name: 'search-press-metroid', path: '/?tab=press&q=metroid', eval: '({ empty: !document.getElementById("empty").hidden, reset: !!document.getElementById("reset"), em: document.getElementById("em").textContent })', check: (r) => (r.evalResult?.empty && !/archive below/.test(r.evalResult.em) && !r.evalResult.reset ? `the empty state lost its button: ${r.evalResult.em}` : null) },
    { name: 'forced-colors', forcedColors: true, path: '/?tab=press', storage: { 'wiivolve:lastVisit': sixHoursAgo } },
    { name: 'forced-colors-dark', forcedColors: true, dark: true },
    { name: 'first-visit-mobile-320', mobile: true, width: 320, height: 700, eval: '[...document.querySelectorAll("#stream .mt b")].filter((b) => b.scrollWidth > b.clientWidth && b.clientWidth < 48).map((b) => b.textContent)', check: (r) => (r.evalResult?.length ? `publisher names cut to a few letters: ${r.evalResult.join(', ')}` : null) },
    { name: 'birthday-dark-mobile', path: '/?now=2026-11-19T15:00:00Z', mobile: true, dark: true, eval: 'getComputedStyle(document.documentElement).getPropertyValue("--glow").trim()', check: (r) => (r.evalResult === '255 168 62' ? null : `the birthday glow is ${r.evalResult}, not warm`) },
    { name: 'about-tab-mobile', mobile: true, setup: 'document.querySelector(".about-btn").click()', keys: Array(30).fill('Tab'), eval: '({ open: document.getElementById("about").matches(":popover-open"), focus: document.activeElement?.className || document.activeElement?.tagName })', noImage: true, check: (r) => (r.evalResult?.open ? 'focus moved on but the About panel stayed open over it' : null) },
  ];
}

const count = (re, s) => (s.match(re) || []).length;

export async function staticChecks(dir) {
  const problems = [];
  const warnings = [];
  const read = async (f) => (existsSync(path.join(dir, f)) ? readFile(path.join(dir, f), 'utf8') : null);
  const html = await read('index.html');
  if (!html) return { problems: ['index.html missing'], warnings, sizes: {} };

  const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
  const id = (x) => new RegExp(`\\sid\\s*=\\s*["']${x}["']`).test(html);
  for (const hook of ['main', 'console', 'stream', 'deep-end', 'archive', 'search', 'about', 'status']) {
    if (!id(hook)) problems.push(`missing #${hook}`);
  }
  if (!/<main[^>]*\sid=["']main["']/.test(html)) problems.push('#main must be the <main> element');
  if (!/<button[^>]*\sid=["']console["']|id=["']console["'][^>]*>/.test(html) || !/<button[^>]*id=["']console["']/.test(html)) problems.push('#console must be a <button>');
  if (!/<input[^>]*type=["']search["'][^>]*id=["']search["']|<input[^>]*id=["']search["'][^>]*type=["']search["']/.test(html)) problems.push('#search must be <input type="search">');
  if (!/\spopover(\s|=|>)/.test(html)) problems.push('#about should use the popover attribute');
  if (!/popovertarget=["']about["']/.test(html)) problems.push('no control with popovertarget="about"');
  if (tags.some((t) => /\sstyle\s*=/.test(t))) problems.push('style="" attribute found (blocked by CSP)');
  if (/<style[\s>]/i.test(html)) problems.push('<style> element found (blocked by CSP)');
  if (tags.some((t) => /^<script\b/i.test(t) && !/\ssrc\s*=/.test(t) && !/application\/ld\+json/.test(t))) problems.push('inline <script> found (blocked by CSP)');
  if (tags.some((t) => /\son[a-z]+\s*=/i.test(t))) problems.push('on*= handler attribute found (blocked by CSP)');
  if (/(href|src)\s*=\s*["']\s*javascript:/i.test(html)) problems.push('javascript: URL found');
  const h1 = count(/<h1[\s>]/gi, html);
  if (h1 !== 1) problems.push(`expected exactly one <h1>, found ${h1}`);
  if (!/<html[^>]*\slang=/.test(html)) problems.push('<html lang> missing');

  const head = (html.split(/<\/head>/i)[0] || '');
  const needs = {
    'meta charset': /<meta[^>]+charset/i,
    viewport: /name=["']viewport["']/i,
    title: /<title>[^<]+<\/title>/i,
    description: /name=["']description["']/i,
    canonical: /rel=["']canonical["']/i,
    'og:title': /property=["']og:title["']/i,
    'og:image': /property=["']og:image["'][^>]*content=["']https?:\/\//i,
    'og:url': /property=["']og:url["']/i,
    'twitter:card': /name=["']twitter:card["']/i,
    'theme-color': /name=["']theme-color["']/i,
    'rss alternate': /type=["']application\/rss\+xml["']/i,
    'json feed alternate': /type=["']application\/feed\+json["']/i,
    manifest: /rel=["']manifest["']/i,
    'svg icon': /rel=["']icon["'][^>]*favicon\.svg|favicon\.svg[^>]*rel=["']icon["']/i,
    'apple-touch-icon': /apple-touch-icon/i,
    'font preload': /rel=["']preload["'][^>]*\.woff2|\.woff2[^>]*rel=["']preload["']/i,
    stylesheet: /href=["']\/style\.css/i,
    'module script': /<script[^>]*type=["']module["'][^>]*src=["']\/app\.js|<script[^>]*src=["']\/app\.js[^>]*type=["']module["']/i,
    'json-ld': /application\/ld\+json/i,
  };
  for (const [name, re] of Object.entries(needs)) if (!re.test(head)) problems.push(`head: ${name} missing`);

  const items = tags.filter((t) => /\sdata-item(\s|=|>)/.test(t));
  for (const t of items) {
    for (const a of ['data-id', 'data-tab', 'data-source', 'data-published', 'data-first-seen']) {
      if (!new RegExp(`\\s${a}=`).test(t)) {
        problems.push(`an item tag lacks ${a}: ${t.slice(0, 120)}`);
        break;
      }
    }
  }
  const news = JSON.parse((await read('news.json')) || '{"items":[]}');
  const archive = JSON.parse((await read('archive.json')) || '{"items":[]}');
  const expected = news.items.length + archive.items.length;
  if (expected && items.length !== expected) problems.push(`expected ${expected} [data-item] elements, found ${items.length}`);
  for (const it of [...news.items, ...archive.items]) {
    if (!html.includes(`data-id="${it.id}"`)) problems.push(`item ${it.id} not rendered`);
  }
  if (!count(/<time[^>]+datetime=/gi, html)) problems.push('no <time datetime> elements');
  if (!/legacy\/header-2009\.webp/.test(html)) warnings.push('2009 header artifact not referenced');

  const nf = await read('404.html');
  if (!nf) problems.push('404.html missing');
  else if (!/No disc inserted/i.test(nf)) warnings.push('404.html lacks "No disc inserted."');

  const sizes = {};
  for (const [k, f] of [['html', 'index.html'], ['css', 'style.css'], ['js', 'app.js']]) {
    const p = path.join(dir, f);
    if (!existsSync(p)) {
      problems.push(`${f} missing`);
      continue;
    }
    const buf = await readFile(p);
    sizes[k] = { raw: buf.length, gzip: gzipSync(buf).length };
    // Over budget is a failure, as ARCHITECTURE section 8 says (the renderer keeps index.html inside both).
    if (buf.length > BUDGETS[k].raw) problems.push(`${f} is ${buf.length} bytes, over the ${BUDGETS[k].raw} byte budget`);
    if (sizes[k].gzip > BUDGETS[k].gzip) problems.push(`${f} is ${sizes[k].gzip} bytes gzipped, over the ${BUDGETS[k].gzip} byte gzip budget`);
  }
  return { problems, warnings, sizes, itemCount: items.length };
}

export async function runQa(dir, shotsDir, { only = null, shots = true } = {}) {
  const abs = path.resolve(dir);
  const checks = await staticChecks(abs);
  let shotReports = [];
  let list = [];
  if (shots) {
    const server = await startServer({ dir: abs, port: 0 });
    try {
      await mkdir(shotsDir, { recursive: true });
      const legacyMap = JSON.parse((existsSync(path.join(abs, 'legacy-map.json')) && (await readFile(path.join(abs, 'legacy-map.json'), 'utf8'))) || '{}');
      list = standardShots(new Date(), { legacyMap })
        .filter((s) => !only || only.includes(s.name))
        .map((s) => ({
          ...s,
          url: server.url + (s.path || '/'),
          out: s.noImage ? undefined : path.join(shotsDir, `${s.name}.png`),
        }));
      shotReports = (await shootAll(list)).map((r, i) => ({ name: list[i].name, ...r }));
    } finally {
      await server.close();
    }
  }
  shotReports.forEach((r, i) => {
    const issues = [
      ...(r.toolError ? [`tool: ${r.toolError}`] : []),
      ...(r.errors || []).map((e) => `JS error: ${e.split('\n')[0]}`),
      ...(r.csp || []).map((e) => `CSP: ${e.slice(0, 160)}`),
      ...(r.failedRequests || []).map((e) => `request: ${e}`),
    ];
    const verdict = !r.toolError && list[i].check ? list[i].check(r) : null;
    if (verdict) issues.push(verdict);
    for (const issue of issues) checks.problems.push(`shot ${r.name}: ${issue}`);
    for (const c of r.consoleErrors || []) checks.warnings.push(`shot ${r.name}: console: ${c.slice(0, 160)}`);
  });
  const legacy = shotReports.find((r) => r.name === 'legacy-bounce');
  if (legacy) {
    const map = JSON.parse((existsSync(path.join(abs, 'legacy-map.json')) && (await readFile(path.join(abs, 'legacy-map.json'), 'utf8'))) || '{}');
    legacy.via = legacyTarget(map, 12).via;
  }
  const report = { dir: abs, ...checks, shots: shotReports };
  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    await writeFile(path.join(shotsDir, 'report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

export function summarize(report) {
  const lines = [];
  lines.push(`QA ${report.dir}`);
  lines.push(`  items rendered: ${report.itemCount ?? 0}`);
  for (const [k, v] of Object.entries(report.sizes || {})) lines.push(`  ${k}: ${v.raw} B raw, ${v.gzip} B gzip`);
  lines.push(`  problems: ${report.problems.length ? '' : 'none'}`);
  for (const p of report.problems) lines.push(`    ✗ ${p}`);
  lines.push(`  warnings: ${report.warnings.length ? '' : 'none'}`);
  for (const w of report.warnings) lines.push(`    ! ${w}`);
  for (const s of report.shots || []) {
    if (s.name.startsWith('legacy-bounce')) {
      const ok = !report.problems.some((p) => p.startsWith(`shot ${s.name}:`));
      lines.push(`  shot ${s.name.padEnd(30)} ${ok ? 'bounced to' : 'did NOT bounce to the expected page:'} ${String(s.evalResult).slice(0, 110)}${s.via ? ` (newsId 12: ${s.via})` : ''}`);
      continue;
    }
    const issues = [
      ...(s.toolError ? [`tool: ${s.toolError}`] : []),
      ...(s.errors || []).map((e) => `js: ${e.split('\n')[0]}`),
      ...(s.csp || []).map((e) => `csp: ${e.slice(0, 140)}`),
      ...(s.consoleErrors || []).map((e) => `console: ${e.slice(0, 140)}`),
      ...(s.failedRequests || []).map((e) => `request: ${e}`),
    ];
    const shown = typeof s.evalResult === 'object' ? JSON.stringify(s.evalResult) : String(s.evalResult);
    const metrics = `cls=${s.cls ?? '-'}${s.evalResult !== undefined ? ` eval=${shown.slice(0, 110)}` : ''}`;
    // A failed per-shot check is a problem (listed above), so the shot is not "clean" either.
    const failed = report.problems.some((p) => p.startsWith(`shot ${s.name}: `) && !/^shot [^:]+: (tool|JS error|CSP|request): /.test(p));
    lines.push(`  shot ${s.name.padEnd(30)} ${issues.length ? `${issues.length} issue(s)` : failed ? 'FAILED its check' : 'clean'}  ${metrics}`);
    for (const i of issues.slice(0, 6)) lines.push(`      - ${i}`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
  const dir = pos[0] || 'site';
  const shotsDir = pos[1] || 'work/shots';
  const report = await runQa(dir, shotsDir, { only, shots: !flags.has('--no-shots') });
  console.log(summarize(report));
  if (report.problems.length) process.exit(1);
}
