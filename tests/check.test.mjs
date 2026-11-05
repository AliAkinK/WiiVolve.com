// Tests for scripts/check.mjs. No network: every request goes to a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runChecks,
  syncIssue,
  main,
  resolveSiteUrl,
  extractArchiveLinks,
  checkXml,
  checkRss,
  checkJsonFeed,
  evaluateHealth,
  formatReport,
  parseJsonLoose,
  LABEL,
} from '../scripts/check.mjs';

const NOW = new Date('2026-11-09T09:00:00Z');
const SITE = 'https://wiivolve.test';
const API = 'https://api.github.test';
const REPO = 'ali/wiivolve';
const SNAPSHOTS = [
  'https://web.archive.org/web/20070703152325/http://wiivolve.com/',
  'https://web.archive.org/web/20060826001626/http://wiivolve.com/',
  'https://web.archive.org/web/20110509/http://wiivolve.com/fullNews.php?newsId=267',
];

const pageHtml = (links = SNAPSHOTS) =>
  '<!doctype html><html lang="en"><head><title>WiiVolve</title></head><body><main id="main">' +
  links.map((l) => `<a href="${l.replace(/&/g, '&amp;')}">old</a>`).join('\n') +
  `<a href="${links[0] ?? '/'}">same link again</a><a href="https://www.nintendolife.com/news">not archive</a>` +
  '</main></body></html>';

const okSource = (id, extra = {}) => ({
  id, name: id, tab: 'press', homepage: `https://${id}.example`, status: 'ok',
  lastOk: '2026-11-09T08:17:00Z', failures: 0, items: 3, httpStatus: 200, error: null, ms: 300, ...extra,
});

const healthJson = ({ generatedAt = '2026-11-09T08:17:00Z', sources = [okSource('nintendolife'), okSource('hackaday')] } = {}) =>
  JSON.stringify({ version: 1, generatedAt, sources, summary: { ok: sources.length, total: sources.length } });

const RSS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
  '<title>WiiVolve</title><link>https://wiivolve.com/</link><description>Wii news</description>' +
  '<atom:link href="https://wiivolve.com/feed.xml" rel="self" type="application/rss+xml"/>' +
  '<item><title>Wii &amp; friends &#8217;26</title><link>https://example.com/a?x=1&amp;y=2</link>' +
  '<guid isPermaLink="false">a3f9c1d2e4b5</guid><pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate>' +
  '<description><![CDATA[Tom & Jerry <b>on Wii</b>]]></description><source url="https://example.com/">Example</source>' +
  '<category>press</category></item></channel></rss>\n';

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1', title: 'WiiVolve', home_page_url: 'https://wiivolve.com/',
  items: [{ id: 'a3f9c1d2e4b5', url: 'https://example.com/a', title: 'Wii', content_text: 'Wii', tags: ['press'] }],
});

const respond = (body, status = 200, headers = {}) => () => new Response(body, { status, headers });
const networkError = () => () => {
  throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
};

/** A fake fetch: routes are keyed "METHOD url" or "url"; a route may be an array used in order. */
function fakeFetch(overrides = {}) {
  const routes = {
    [`${SITE}/`]: respond(pageHtml(), 200, { 'content-type': 'text/html; charset=utf-8' }),
    [`${SITE}/health.json`]: respond(healthJson()),
    [`${SITE}/feed.xml`]: respond(RSS),
    [`${SITE}/feed.json`]: respond(JSON_FEED),
    'https://web.archive.org/': respond('<html>Wayback</html>'),
    ...Object.fromEntries(SNAPSHOTS.map((s) => [s, respond('<html>snapshot</html>')])),
    ...overrides,
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    let route = routes[`${method} ${url}`] ?? routes[String(url)];
    if (Array.isArray(route)) route = route.length > 1 ? route.shift() : route[0];
    return route ? route() : new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const noSleep = () => {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
};

const check = (overrides, extra = {}) => {
  const f = fakeFetch(overrides);
  const s = noSleep();
  return runChecks({ siteUrl: SITE, fetch: f.fetch, now: NOW, sleep: s.sleep, ...extra }).then((report) => ({ report, ...f, ...s }));
};

// GitHub API routes for syncIssue / main.
const gh = (route) => `${API}/repos/${REPO}${route}`;
const ghRoutes = ({ labelExists = true, openIssues = [] } = {}) => ({
  [`GET ${gh(`/labels/${LABEL}`)}`]: labelExists ? respond(JSON.stringify({ name: LABEL })) : respond('{"message":"Not Found"}', 404),
  [`POST ${gh('/labels')}`]: respond(JSON.stringify({ name: LABEL }), 201),
  [`GET ${gh(`/issues?state=open&labels=${LABEL}&per_page=100`)}`]: respond(JSON.stringify(openIssues)),
  [`POST ${gh('/issues')}`]: respond(JSON.stringify({ number: 12 }), 201),
  [`POST ${gh('/issues/7/comments')}`]: respond(JSON.stringify({ id: 1 }), 201),
  [`PATCH ${gh('/issues/7')}`]: respond(JSON.stringify({ number: 7, state: 'closed' })),
});
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && c.url.startsWith(API));

// ---------------------------------------------------------------------------------------------

test('all checks pass: no problems, no notes, archive links deduplicated and paced', async () => {
  const { report, calls, slept } = await check();
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.notes, []);
  assert.deepEqual(report.checks.map((c) => [c.name, c.status]), [
    ['Live page', 'ok'], ['health.json', 'ok'], ['Sources', 'ok'], ['Archive links', 'ok'], ['feed.xml', 'ok'], ['feed.json', 'ok'],
  ]);
  for (const s of SNAPSHOTS) assert.equal(calls.filter((c) => c.url === s).length, 1, `checked once: ${s}`);
  assert.ok(!calls.some((c) => c.url.includes('nintendolife')), 'only web.archive.org links are checked');
  assert.equal(slept.filter((ms) => ms === 2500).length, SNAPSHOTS.length, 'a pause before every archive request');
  assert.match(formatReport(report), /All clear/);
});

test('the live site is down: reported, archive links skipped, retried before giving up', async () => {
  const { report, calls } = await check({ [`${SITE}/`]: networkError() });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /did not answer properly \(ECONNREFUSED/);
  assert.equal(calls.filter((c) => c.url === `${SITE}/`).length, 3, 'three attempts');
  assert.ok(!calls.some((c) => c.url.startsWith('https://web.archive.org')), 'no archive requests without the page');
  assert.match(report.notes.join(' '), /not checked because the live page did not load/);
});

test('a transient 503 from the live site is retried and passes', async () => {
  const { report } = await check({ [`${SITE}/`]: [respond('busy', 503), respond(pageHtml())] });
  assert.deepEqual(report.problems, []);
});

test('health.json older than 26 hours is a problem', async () => {
  const { report } = await check({ [`${SITE}/health.json`]: respond(healthJson({ generatedAt: '2026-11-08T03:00:00Z' })) });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /health\.json is 30 hours old/);
  assert.equal(report.checks.find((c) => c.name === 'health.json').status, 'problem');
});

test('health.json that is missing or not JSON is a problem', async () => {
  const missing = await check({ [`${SITE}/health.json`]: respond('nope', 404) });
  assert.match(missing.report.problems.join(' '), /health\.json did not load \(HTTP 404\)/);
  const broken = await check({ [`${SITE}/health.json`]: respond('{"version":1,') });
  assert.match(broken.report.problems.join(' '), /health\.json is not valid JSON/);
});

test('a source down for more than 7 days is a problem; down for less is only a note', async () => {
  const sources = [
    okSource('nintendolife'),
    okSource('reddit-wii', { name: 'r/wii', status: 'down', lastOk: '2026-10-30T09:17:00Z', failures: 230, httpStatus: 429, error: 'HTTP 429' }),
    okSource('dolphin', { name: 'Dolphin Emulator', status: 'down', lastOk: '2026-11-07T10:17:00Z', failures: 40 }),
    okSource('hackaday', { status: 'stale', failures: 2 }),
  ];
  const { report } = await check({ [`${SITE}/health.json`]: respond(healthJson({ sources })) });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /^r\/wii \(reddit-wii\) has been down for 10 days \(last OK 2026-10-30T09:17:00Z; last error: HTTP 429\)/);
  assert.equal(report.notes.length, 1);
  assert.match(report.notes[0], /Dolphin Emulator \(dolphin\) is down/);
  assert.equal(report.checks.find((c) => c.name === 'Sources').detail, '4 sources, 1 down for more than 7 days');
});

test('a source that is down and never succeeded is a problem', () => {
  const h = evaluateHealth(
    { generatedAt: '2026-11-09T08:17:00Z', sources: [okSource('x', { status: 'down', lastOk: null, error: 'HTTP 403' })] },
    NOW,
  );
  assert.equal(h.problems.length, 1);
  assert.match(h.problems[0], /never fetched successfully; last error: HTTP 403/);
});

test('a broken archive link (404 twice, a minute apart) is a problem and names the link', async () => {
  const { report, calls, slept } = await check({ [SNAPSHOTS[1]]: respond('Hrm. Wayback Machine has not archived that URL.', 404) });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /Archive link is broken \(HTTP 404, twice a minute apart\): https:\/\/web\.archive\.org\/web\/20060826001626/);
  assert.equal(report.checks.find((c) => c.name === 'Archive links').detail, '2 of 3 OK, 1 broken');
  assert.equal(calls.filter((c) => c.url === SNAPSHOTS[1]).length, 2, 'asked again before calling it broken');
  assert.ok(slept.includes(60e3));
});

test('a 404 that answers on the second ask is fine: one bad minute on Wayback opens no issue (ops-16)', async () => {
  const { report } = await check({ [SNAPSHOTS[1]]: [respond('not archived', 404), respond('<html>snapshot</html>')] });
  assert.deepEqual(report.problems, []);
  assert.equal(report.checks.find((c) => c.name === 'Archive links').detail, '3 of 3 OK');
});

test('a 404 with no time left to ask again is unverified, never broken on one answer (engine-claims-6)', async () => {
  // Every snapshot takes 3 minutes of the 8-minute budget; the first link answers 404 once.
  let t = 0;
  const slow = (status) => () => {
    t += 3 * 60e3;
    return new Response(status === 404 ? 'not archived' : '<html>snapshot</html>', { status });
  };
  const f = fakeFetch({ [SNAPSHOTS[0]]: [slow(404), slow(200)], [SNAPSHOTS[1]]: slow(200), [SNAPSHOTS[2]]: slow(200) });
  const report = await runChecks({ siteUrl: SITE, fetch: f.fetch, now: NOW, sleep: async (ms) => void (t += ms), clock: () => t });
  assert.deepEqual(report.problems, [], 'one 404 is not enough to call the link broken');
  assert.equal(f.calls.filter((c) => c.url === SNAPSHOTS[0]).length, 1, 'no second ask without the minute in between');
  assert.match(report.notes.join(' '), /20070703152325\/http:\/\/wiivolve\.com\/ \(HTTP 404 once; no time left to ask again\)/);
  assert.match(report.checks.find((c) => c.name === 'Archive links').detail, /unverified/);
});

test('a slow Wayback Machine cannot push the weekly check past its job timeout (ops-4)', async () => {
  // 22 links whose snapshots all time out; the fake clock advances with every pause and request.
  const links = Array.from({ length: 22 }, (_, i) => `https://web.archive.org/web/200701010000${String(i).padStart(2, '0')}/http://wiivolve.com/`);
  let t = 0;
  const hanging = () => async () => {
    t += 20e3;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  const f = fakeFetch({ [`${SITE}/`]: respond(pageHtml(links), 200, { 'content-type': 'text/html' }), ...Object.fromEntries(links.map((l) => [l, hanging()])) });
  const report = await runChecks({ siteUrl: SITE, fetch: f.fetch, now: NOW, sleep: async (ms) => void (t += ms), clock: () => t });
  assert.ok(t < 8 * 60e3, `archive checks took ${Math.round(t / 1000)} s of virtual time`);
  assert.deepEqual(report.problems, [], 'unverified links are a note, not a problem');
  assert.match(report.notes.join(' '), /22 archive links could not be verified .*three links in a row/);
  assert.equal(f.calls.filter((c) => links.includes(c.url)).length, 6, 'three links, two tries each, then it stops asking');

  // A budget runs out the same way when every link is merely slow.
  t = 0;
  let n = 0;
  const slowOk = () => async () => {
    t += 60e3;
    n++;
    return new Response('<html>snapshot</html>');
  };
  const g = fakeFetch({ [`${SITE}/`]: respond(pageHtml(links), 200, { 'content-type': 'text/html' }), ...Object.fromEntries(links.map((l) => [l, slowOk()])) });
  const slow = await runChecks({ siteUrl: SITE, fetch: g.fetch, now: NOW, sleep: async (ms) => void (t += ms), clock: () => t });
  assert.ok(n < 22 && t < 10 * 60e3, `${n} links in ${Math.round(t / 1000)} s`);
  assert.match(slow.notes.join(' '), /time budget used/);
});

test('an archive link answering 429 is retried after Retry-After', async () => {
  const { report, slept } = await check({ [SNAPSHOTS[0]]: [respond('slow down', 429, { 'retry-after': '20' }), respond('ok')] });
  assert.deepEqual(report.problems, []);
  assert.ok(slept.includes(20000), 'waited for Retry-After');
});

test('web.archive.org unreachable: a note instead of a failure, links not requested', async () => {
  const { report, calls } = await check({ 'https://web.archive.org/': networkError() });
  assert.deepEqual(report.problems, []);
  assert.equal(report.notes.length, 1);
  assert.match(report.notes[0], /web\.archive\.org did not answer \(ECONNREFUSED\), so the 3 archive links were not checked/);
  for (const s of SNAPSHOTS) assert.ok(!calls.some((c) => c.url === s));
  assert.equal(report.checks.find((c) => c.name === 'Archive links').status, 'note');
});

test('archive links that keep answering 503 are unverified notes, not problems', async () => {
  const { report } = await check({ [SNAPSHOTS[2]]: respond('maintenance', 503) });
  assert.deepEqual(report.problems, []);
  assert.match(report.notes.join(' '), /1 archive link could not be verified .*fullNews\.php\?newsId=267 \(HTTP 503\)/);
});

test('a malformed feed.xml is a problem', async () => {
  const bad = RSS.replace('Wii &amp; friends', 'Wii & friends');
  const { report } = await check({ [`${SITE}/feed.xml`]: respond(bad) });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /^feed\.xml does not parse: unescaped "&" inside <title>/);
});

test('an invalid feed.json is a problem', async () => {
  const { report } = await check({ [`${SITE}/feed.json`]: respond(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'x', items: {} })) });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0], /^feed\.json does not parse: "items" is not an array/);
});

test('XML checker accepts well-formed feeds and rejects common breakage', () => {
  assert.equal(checkXml(RSS).error, null);
  assert.equal(checkXml('﻿<?xml version="1.0"?><!-- c --><a x="1 > 0"><b/><![CDATA[ & < ]]></a>').error, null);
  assert.equal(checkXml('<!DOCTYPE rss><rss version="2.0"><channel/></rss>').error, null);
  assert.match(checkXml('<a><b></a>').error, /<\/a> closes <b>/);
  assert.match(checkXml('<a>&nbsp;</a>').error, /undefined entity &nbsp;/);
  assert.match(checkXml('<a>&#1;</a>').error, /illegal character reference/);
  assert.match(checkXml('<a x="1" x="2"/>').error, /duplicate attribute/);
  assert.match(checkXml('<a></a><b></b>').error, /more than one root element|text after/);
  assert.match(checkXml('<a>').error, /never closed/);
  assert.match(checkXml('').error, /empty/);
  assert.match(checkXml('<a>\u0001</a>').error, /illegal control character/);
  assert.equal(checkRss(RSS).items, 1);
  assert.match(checkRss('<feed xmlns="http://www.w3.org/2005/Atom"></feed>').error, /not <rss>/);
  assert.match(checkRss('<rss version="2.0"></rss>').error, /no <channel>/);
});

test('JSON Feed checker', () => {
  assert.deepEqual(checkJsonFeed(JSON_FEED), { error: null, items: 1 });
  assert.match(checkJsonFeed('{').error, /not valid JSON/);
  assert.match(checkJsonFeed('{"version":"1","title":"x","items":[]}').error, /version/);
  assert.match(checkJsonFeed(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'x', items: [{ url: 'u' }] })).error, /item 1 has no "id"/);
});

test('extractArchiveLinks decodes entities, dedupes, keeps only web.archive.org, drops fragments', () => {
  const html = `<a href="https://web.archive.org/web/2008/http://wiivolve.com/review.php?articleId=77&amp;page=1">a</a>
    <a class="x" href='http://web.archive.org/web/2008/http://wiivolve.com/review.php?articleId=77&page=1#top'>b</a>
    <a href="https://archive.org/details/x">c</a><a href="/feed.xml">d</a><a href="javascript:alert(1)">e</a>`;
  assert.deepEqual(extractArchiveLinks(html), ['https://web.archive.org/web/2008/http://wiivolve.com/review.php?articleId=77&page=1']);
});

test('site URL: --url, then SITE_URL, then feeds.json (comments allowed), then the default', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiivolve-check-'));
  try {
    const configPath = path.join(dir, 'feeds.json');
    await writeFile(configPath, '{\n  // site metadata\n  "site": { "url": "https://wiivolve.com/", "name": "WiiVolve", },\n}\n');
    assert.equal(await resolveSiteUrl({ argv: ['--url', 'https://a.example/'], env: { SITE_URL: 'https://b.example' }, configPath }), 'https://a.example');
    assert.equal(await resolveSiteUrl({ env: { SITE_URL: 'https://b.example/' }, configPath }), 'https://b.example');
    assert.equal(await resolveSiteUrl({ env: { SITE_URL: '' }, configPath }), 'https://wiivolve.com');
    assert.equal(await resolveSiteUrl({ env: { SITE_URL: 'ftp://nope' }, configPath: path.join(dir, 'missing.json') }), 'https://wiivolve.com');
    assert.deepEqual(parseJsonLoose('{"u":"https://x.example//y", /* c */ "a":[1,2,],}'), { u: 'https://x.example//y', a: [1, 2] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// GitHub issue handling

const failingReport = { siteUrl: SITE, checkedAt: NOW.toISOString(), problems: ['feed.xml does not parse: x.'], notes: [], checks: [] };
const clearReport = { siteUrl: SITE, checkedAt: NOW.toISOString(), problems: [], notes: [], checks: [] };

test('problems and no open issue: creates the label if missing, then opens one labelled issue', async () => {
  const f = fakeFetch(ghRoutes({ labelExists: false }));
  const result = await syncIssue({ report: failingReport, fetch: f.fetch, token: 't0k', repo: REPO, apiUrl: API, now: NOW });
  assert.deepEqual(result, { action: 'created', number: 12 });
  const w = writes(f.calls);
  assert.deepEqual(w.map((c) => `${c.method} ${c.url}`), [`POST ${gh('/labels')}`, `POST ${gh('/issues')}`]);
  assert.equal(w[0].body.name, LABEL);
  assert.deepEqual(w[1].body.labels, [LABEL]);
  assert.equal(w[1].body.title, 'Site check: 1 problem (2026-11-09)');
  assert.match(w[1].body.body, /feed\.xml does not parse/);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer t0k');
});

test('problems and an open issue: comments on it instead of opening another (pull requests ignored)', async () => {
  const openIssues = [{ number: 9, pull_request: { url: 'x' } }, { number: 7, title: 'Site check: 2 problems' }];
  const f = fakeFetch(ghRoutes({ openIssues }));
  const result = await syncIssue({ report: failingReport, fetch: f.fetch, token: 't', repo: REPO, apiUrl: API, now: NOW });
  assert.deepEqual(result, { action: 'commented', number: 7 });
  assert.deepEqual(writes(f.calls).map((c) => `${c.method} ${c.url}`), [`POST ${gh('/issues/7/comments')}`]);
});

test('all clear and an open issue: comments with a note and closes it', async () => {
  const f = fakeFetch(ghRoutes({ openIssues: [{ number: 7 }] }));
  const result = await syncIssue({ report: clearReport, fetch: f.fetch, token: 't', repo: REPO, apiUrl: API, now: NOW });
  assert.deepEqual(result, { action: 'closed', number: 7 });
  const w = writes(f.calls);
  assert.deepEqual(w.map((c) => `${c.method} ${c.url}`), [`POST ${gh('/issues/7/comments')}`, `PATCH ${gh('/issues/7')}`]);
  assert.match(w[0].body.body, /^All clear on 2026-11-09\. Closing\./);
  assert.deepEqual(w[1].body, { state: 'closed', state_reason: 'completed' });
});

test('all clear and no open issue: writes nothing', async () => {
  const f = fakeFetch(ghRoutes());
  const result = await syncIssue({ report: clearReport, fetch: f.fetch, token: 't', repo: REPO, apiUrl: API, now: NOW });
  assert.deepEqual(result, { action: 'none', number: null });
  assert.deepEqual(writes(f.calls), []);
});

// ---------------------------------------------------------------------------------------------
// CLI behaviour (exit codes)

const run = async (overrides, env, argv = []) => {
  const f = fakeFetch(overrides);
  const lines = [];
  const code = await main({
    argv: ['--url', SITE, ...argv], env, fetch: f.fetch, now: NOW, sleep: async () => {}, out: (l) => lines.push(l),
    configPath: '/nonexistent/feeds.json',
  });
  return { code, output: lines.join('\n'), calls: f.calls };
};

test('without GH_TOKEN: prints the report and exits 1 on problems, 0 when clear', async () => {
  const bad = await run({ [`${SITE}/feed.json`]: respond('{') }, {});
  assert.equal(bad.code, 1);
  assert.match(bad.output, /1 problem needs a human/);
  assert.ok(!bad.calls.some((c) => c.url.startsWith(API)));
  const good = await run({}, {});
  assert.equal(good.code, 0);
  assert.match(good.output, /All clear/);
});

test('with GH_TOKEN and GITHUB_REPOSITORY: files the issue and exits 0; --report-only never touches GitHub', async () => {
  const env = { GH_TOKEN: 't', GITHUB_REPOSITORY: REPO, GITHUB_API_URL: API };
  const filed = await run({ [`${SITE}/feed.json`]: respond('{'), ...ghRoutes() }, env);
  assert.equal(filed.code, 0);
  assert.match(filed.output, /Opened issue #12/);
  const reportOnly = await run({ [`${SITE}/feed.json`]: respond('{'), ...ghRoutes() }, env, ['--report-only']);
  assert.equal(reportOnly.code, 1);
  assert.ok(!reportOnly.calls.some((c) => c.url.startsWith(API)));
});

test('a GitHub API failure exits 1 so the failed run is noticed', async () => {
  const env = { GH_TOKEN: 't', GITHUB_REPOSITORY: REPO, GITHUB_API_URL: API };
  const routes = { ...ghRoutes(), [`GET ${gh(`/labels/${LABEL}`)}`]: respond('{"message":"Resource not accessible by integration"}', 403) };
  const result = await run(routes, env);
  assert.equal(result.code, 1);
  assert.match(result.output, /Could not update the GitHub issue: GitHub reading the label failed with HTTP 403: Resource not accessible/);
});

test('the report is appended to GITHUB_STEP_SUMMARY when set', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiivolve-check-'));
  try {
    const summary = path.join(dir, 'summary.md');
    const result = await run({}, { GITHUB_STEP_SUMMARY: summary });
    assert.equal(result.code, 0);
    assert.match(await readFile(summary, 'utf8'), /### WiiVolve site check, 2026-11-09 09:00 UTC/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
