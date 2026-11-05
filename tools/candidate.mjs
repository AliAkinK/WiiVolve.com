#!/usr/bin/env node
// Render a design candidate with the sample data, then run QA and the standard screenshots.
//
//   node tools/candidate.mjs <candidateDir> [--no-shots] [--only name,name]
//
// A candidate directory contains:
//   render.mjs     exports renderPage({ template, news, archive, health, site, now }) per docs/ARCHITECTURE.md §6
//   template.html  the page template
//   style.css, app.js, 404.html   (optional 404.js and an assets/ folder copied to the site root)
// Output: <candidateDir>/out (a complete site), <candidateDir>/shots (PNGs + report.json).
// Sample data comes from work/sample; its timestamps are shifted so the newest item is ~20 minutes old.

import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runQa, summarize } from './qa.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function shiftTimes(obj, deltaMs) {
  const shift = (iso) => new Date(new Date(iso).getTime() + deltaMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    ...obj,
    generatedAt: obj.generatedAt ? shift(obj.generatedAt) : obj.generatedAt,
    items: obj.items?.map((i) => ({ ...i, published: shift(i.published), firstSeen: shift(i.firstSeen) })),
    sources: obj.sources?.map((s) => ({ ...s, lastOk: s.lastOk ? shift(s.lastOk) : s.lastOk })),
    meta: obj.meta && {
      ...obj.meta,
      ...(obj.meta.dolphin ? { dolphin: { ...obj.meta.dolphin, published: shift(obj.meta.dolphin.published) } } : {}),
      // The window and the complete part of each view move with the stories (quiet phrases, section 6.2.3).
      ...(obj.meta.windowStart ? { windowStart: shift(obj.meta.windowStart) } : {}),
      ...(obj.meta.completeSince ? { completeSince: Object.fromEntries(Object.entries(obj.meta.completeSince).map(([k, v]) => [k, shift(v)])) } : {}),
    },
  };
}

export async function buildCandidate(dir, { now = new Date() } = {}) {
  const cand = path.resolve(dir);
  const out = path.join(cand, 'out');
  const sample = path.join(ROOT, 'work/sample');
  const rawNews = JSON.parse(await readFile(path.join(sample, 'news.json'), 'utf8'));
  const newest = Math.max(...rawNews.items.map((i) => new Date(i.firstSeen).getTime()));
  const delta = now.getTime() - 20 * 60e3 - newest;
  const news = shiftTimes(rawNews, delta);
  const health = shiftTimes(JSON.parse(await readFile(path.join(sample, 'health.json'), 'utf8')), delta);
  const archive = JSON.parse(await readFile(path.join(sample, 'archive.json'), 'utf8'));
  let site = {
    url: 'https://wiivolve.com',
    name: 'WiiVolve',
    tagline: 'Still spinning since 2006.',
    description:
      'Fresh Nintendo Wii news and homebrew scene activity, gathered every hour, on the site that covered the Wii from 2006 to 2008.',
    author: 'Ali Kurnaz',
    since: 2006,
    wiiLaunch: '2006-11-19',
    repo: 'https://github.com/example/wiivolve',
  };
  if (existsSync(path.join(ROOT, 'feeds.json'))) {
    try {
      const cfg = JSON.parse(await readFile(path.join(ROOT, 'feeds.json'), 'utf8'));
      site = { ...site, ...cfg.site, repo: cfg.site?.repo || site.repo };
    } catch {}
  }
  const { renderPage } = await import(pathToFileURL(path.join(cand, 'render.mjs')).href + `?t=${now.getTime()}`);
  const template = await readFile(path.join(cand, 'template.html'), 'utf8');
  const html = renderPage({ template, news, archive, health, site, now });

  // Injection canary: a hostile item must come out escaped and unlinked.
  const evil = {
    id: 'evil0000test',
    title: '<img src=x onerror=alert(1)> & "quotes"',
    url: 'javascript:alert(1)',
    source: '<b>Bad</b>',
    sourceId: 'nintendolife',
    tab: 'press',
    published: news.items[0].published,
    firstSeen: news.items[0].firstSeen,
    excerpt: '<script>alert(2)</script>',
    matched: ['Wii'],
  };
  const evilHtml = renderPage({ template, news: { ...news, items: [evil, ...news.items] }, archive, health, site, now });
  const injection = [];
  if (evilHtml.includes('<img src=x')) injection.push('raw <img> from a title reached the HTML');
  if (/javascript:alert/i.test(evilHtml)) injection.push('javascript: URL reached the HTML');
  if (evilHtml.includes('<script>alert(2)')) injection.push('raw <script> from an excerpt reached the HTML');
  if (evilHtml.includes('<b>Bad</b>')) injection.push('raw HTML from a source name reached the HTML');
  const deterministic = renderPage({ template, news, archive, health, site, now }) === html;

  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'fonts'), { recursive: true });
  await mkdir(path.join(out, 'legacy'), { recursive: true });
  await writeFile(path.join(out, 'index.html'), html);
  await writeFile(path.join(out, 'news.json'), JSON.stringify(news, null, 2));
  await writeFile(path.join(out, 'archive.json'), JSON.stringify(archive, null, 2));
  await writeFile(path.join(out, 'health.json'), JSON.stringify(health, null, 2));
  for (const f of ['style.css', 'app.js', '404.html', '404.js']) {
    if (existsSync(path.join(cand, f))) await cp(path.join(cand, f), path.join(out, f));
  }
  if (existsSync(path.join(cand, 'assets'))) await cp(path.join(cand, 'assets'), out, { recursive: true });
  await cp(path.join(ROOT, 'site/fonts'), path.join(out, 'fonts'), { recursive: true });
  const webp = path.join(out, 'legacy/header-2009.webp');
  try {
    execFileSync('cwebp', ['-quiet', '-q', '90', path.join(ROOT, 'legacy-assets/skin-2009/header.png'), '-o', webp]);
  } catch {
    await cp(path.join(ROOT, 'legacy-assets/skin-2009/header.png'), webp);
  }
  if (!existsSync(path.join(out, 'manifest.webmanifest'))) {
    await writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify({ name: 'WiiVolve', short_name: 'WiiVolve', start_url: '/', display: 'standalone', icons: [] }));
  }
  if (!existsSync(path.join(out, 'apple-touch-icon.png'))) {
    await cp(path.join(ROOT, 'legacy-assets/favicon-2007.png'), path.join(out, 'apple-touch-icon.png'));
  }
  if (!existsSync(path.join(out, 'favicon.svg'))) {
    await writeFile(path.join(out, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="9" width="26" height="14" rx="5" fill="#eef1f5"/><rect x="7" y="15" width="18" height="2" rx="1" fill="#2f7df6"/></svg>');
  }
  await writeFile(
    path.join(out, '_headers'),
    `/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`,
  );
  return { out, injection, deterministic };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
  if (!dir) {
    console.error('Usage: node tools/candidate.mjs <candidateDir> [--no-shots] [--only name,name]');
    process.exit(2);
  }
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
  const { out, injection, deterministic } = await buildCandidate(dir);
  const report = await runQa(out, path.join(path.resolve(dir), 'shots'), { only, shots: !args.includes('--no-shots') });
  report.injection = injection;
  report.deterministic = deterministic;
  await writeFile(path.join(path.resolve(dir), 'shots', 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
  console.log(summarize(report));
  console.log(`  injection test: ${injection.length ? 'FAILED\n    ' + injection.join('\n    ') : 'passed'}`);
  console.log(`  deterministic render: ${deterministic ? 'yes' : 'NO'}`);
  console.log(`  shots: ${path.join(path.resolve(dir), 'shots')}`);
  if (report.problems.length || injection.length || !deterministic) process.exit(1);
}
