// WiiVolve page renderer ("Quiet Console").
//
//   renderPage({ template, news, archive, health, site, now }) -> complete index.html (string)
//
// Pure and deterministic (docs/ARCHITECTURE.md section 6): every date comes from `now` in UTC (no
// Date.now(), no randomness), every string that came from a feed is escaped, and only http(s) URLs
// ever become links. templates/index.html marks slots as <!--@name-->; unknown slots render empty.
// site/app.js repeats the date logic (day groups, the placing of quiet gaps, age line) in the reader's local time.

import { gzipSync } from 'node:zlib';
import { DAY, isoSeconds } from './util.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const KINDS = { feature: 'Feature', review: 'Review', preview: 'Preview', milestone: 'Milestone' }; // posts get no label
const STATUS = { ok: 'OK', stale: 'Retrying', down: 'Down' };
const MONTH_GROUP_AFTER = 45; // days; older live items are grouped by month
const QUIET_DAYS = 7; // a gap this long between two groups is written out: "Four quiet weeks."
const ARCHIVE_GAP = 21 * DAY; // archive years this far apart get a dotted spine (no words: the archive is a selection)
const PAGE_BUDGET = 63 * 1024; // bytes, under the 64 KB HTML budget with room to spare
const GZIP_BUDGET = 15.5 * 1024; // gzip bytes (what visitors download), under the 16 KB budget
const EXCERPT_STEPS = [Infinity, 160, 120, 90, 60, 0]; // live excerpt lengths tried until the page fits
export const CAPTIONS = {
  idle: 'The slot glows when something new arrives.',
  lit: 'Psst, something new. Press the console to jump in.',
  bday: 'Party hat on, confetti out, slot glowing.',
};
// The line before the first story older than the window (section 6.2.3): below it the list is a selection.
export const FURTHER = 'Further back: a few picks per source.';

// The characters the display face draws (site/fonts/bricolage-grotesque-96.woff2 is a Latin subset), as hex
// code point ranges. `node tools/font-coverage.mjs` prints it from the font; tests/render.test.mjs checks it.
export const DISPLAY_COVERAGE =
  '20-7e a0-a3 a5-ac ae-ff 102 131 152-153 2c6 2da 2dc 300-301 303-304 308-309 323 2002 2009 200b 2013-2014 ' +
  '2018-201a 201c-201e 2022 2026 2032-2033 2039-203a 2044 20ac 2122 2191 2193 2212';
const COVERED = DISPLAY_COVERAGE.split(' ').map((r) => {
  const [a, b = a] = r.split('-').map((h) => parseInt(h, 16));
  return [a, b];
});

/** True when the display face has every character of `text`. A headline it cannot draw whole ("Ōkami", "‰") is
 * set in the system face (class "sys"), so it never switches fonts mid-word. */
export function inDisplayFace(text) {
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    if (!COVERED.some(([a, b]) => c >= a && c <= b)) return false;
  }
  return true;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML content and for quoted attribute values. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Returns the normalized URL when it is absolute http(s), otherwise null (javascript:, data:, relative, junk). */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const toMs = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const dayNum = (t) => Math.floor(t / DAY);
const pad = (n) => String(n).padStart(2, '0');
const shortDate = (d) => `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
const clock = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
const word = (n) => WORDS[n] ?? String(n);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stories = (n) => (n === 1 ? '1 story' : `${n} stories`);

/** The hero age line in UTC (app.js recomputes it in local time). Returns { birthday, html, text }. */
export function ageLine(nowMs, launch = '2006-11-19') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(launch || '') || [null, '2006', '11', '19'];
  const ly = +m[1], lm = +m[2] - 1, ld = +m[3];
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
  const today = Date.UTC(y, mo, da);
  const n = (v) => `<span class="n">${v}</span>`;
  const count = (v, w) => `${n(v)} ${w}${v === 1 ? '' : 's'}`;
  const birthday = mo === lm && da === ld && y > ly;
  let html;
  // A no-break space keeps the greeting and its name on one line: "Happy birthday, / Wii." reads wrong.
  if (birthday) html = `Happy birthday,\u00a0Wii. ${n(y - ly)} today.`;
  else {
    const twentieth = Date.UTC(ly + 20, lm, ld);
    if (today < twentieth) html = `${n(20)} years in ${count(Math.round((twentieth - today) / DAY), 'day')}.`;
    else {
      const years = y - ly - (mo < lm || (mo === lm && da < ld) ? 1 : 0);
      html = `${count(years, 'year')} and ${count(Math.round((today - Date.UTC(ly + years, lm, ld)) / DAY), 'day')} old.`;
    }
  }
  return { birthday, html, text: html.replace(/<[^>]*>/g, '') };
}

/** A gap of `days` written out: "Seven quiet days.", "Four quiet weeks.", "Three quiet months.", "Eighteen quiet years." */
export function quietPhrase(days) {
  const [n, unit] =
    days < 14 ? [days, 'days'] : days < 63 ? [Math.floor(days / 7), 'weeks'] : days < 730 ? [Math.floor(days / 30.44), 'months'] : [Math.floor(days / 365.25), 'years'];
  return `${capital(word(n))} quiet ${unit}.`;
}

/** Publisher names arrive as domains sometimes ("www.wargamer.com"); the builder cleans them, this is a guard. */
const displaySource = (s) => clean(s).replace(/^www\./i, '');

/** Some feeds leak a stylesheet rule into the start of an excerpt (".noscript-hide { display: none; } …"). */
const cleanExcerpt = (s) => clean(s).replace(/^(?:[.#]?[\w-]+(?:\s*,\s*[.#]?[\w-]+)*\s*\{[^{}]*\}\s*)+/, '');

/** Shortens text on a word boundary to at most n characters, ending with "…" (the page budget guard). */
function clip(s, n) {
  if (s.length <= n) return s;
  if (n < 20) return '';
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > n / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?…-]+$/, '')}…`;
}

/** An item's time: published, else firstSeen, else now; never in the future. */
const itemTime = (it, nowMs) => Math.min(toMs(it.published) ?? toMs(it.firstSeen) ?? nowMs, nowMs);

function renderItem(it, ctx) {
  const t = itemTime(it, ctx.now);
  const d = new Date(t);
  const seen = toMs(it.firstSeen) ?? t;
  const url = safeUrl(it.url);
  const plainTitle = clean(it.title) || 'Untitled';
  const title = escapeHtml(plainTitle);
  const source = escapeHtml(displaySource(it.source) || (ctx.archive ? 'WiiVolve' : 'Unknown source'));
  // "=" is also encoded in the attribute copy, so no feed text can ever read like an on*= handler there.
  const sourceAttr = source.replace(/=/g, '&#61;');
  const hl = ctx.archive || inDisplayFace(plainTitle) ? 'hl' : 'hl sys';
  let head = url ? `<a class="${hl}" href="${escapeHtml(url)}" rel="noopener">${title}</a>` : `<span class="${hl}">${title}</span>`;
  const meta = [];
  if (ctx.archive) {
    // The 2007 date bar read "Tuesday, July 3, 2007"; phones drop the weekday.
    meta.push(`<time datetime="${isoSeconds(t)}"><span class="wd">${WEEKDAYS[d.getUTCDay()]}, </span>${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}</time>`);
    if (KINDS[it.kind]) meta.push(`<span>${KINDS[it.kind]}</span>`);
  } else {
    // Recent items show a UTC clock time (their day is in the group label); older ones a date. app.js makes both relative.
    meta.push(`<b>${source}</b>`, `<time datetime="${isoSeconds(t)}">${dayNum(ctx.now) - dayNum(t) < 2 ? clock(d) : shortDate(d)}</time>`);
    if (it.via) meta.push(`<span class="via">via ${escapeHtml(clean(it.via))}</span>`);
    if (url && url === ctx.dolphin) head += ' <span class="note">Latest release</span>';
  }
  // Pills lead the row, so a wrapped row never starts with a separator dot.
  if (it.note) meta.unshift(`<span class="note">${escapeHtml(clean(it.note))}</span>`);
  const ex = clip(cleanExcerpt(it.excerpt), ctx.exMax ?? Infinity);
  const tab = ctx.archive ? 'archive' : it.tab === 'press' ? 'press' : 'scene';
  // The quiet phrase above this story in All (data-qa) and in its own tab (data-qt), where true (section 6.2.3).
  const quiet = `${ctx.qa ? ` data-qa="${ctx.qa}"` : ''}${ctx.qt ? ` data-qt="${ctx.qt}"` : ''}`;
  return (
    `<li class="it${ctx.origin ? ' origin' : ''}" data-item data-id="${escapeHtml(it.id)}" data-tab="${tab}" data-source="${sourceAttr}"` +
    ` data-published="${isoSeconds(t)}" data-first-seen="${isoSeconds(seen)}"${quiet}>${head}<p class="mt">${meta.join('')}</p>` +
    `${ex ? `<p class="ex">${escapeHtml(ex)}</p>` : ''}</li>`
  );
}

/** Day or month group of a live item relative to now, in UTC: Today, Yesterday, weekday, "Oct 26", "September 2026". */
function liveGroup(t, nowMs) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const diff = dayNum(nowMs) - dayNum(t);
  if (diff > MONTH_GROUP_AFTER) return { y, key: `${y}-${d.getUTCMonth()}`, label: `${MONTHS[d.getUTCMonth()]} ${y}` };
  const label = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? WEEKDAYS[d.getUTCDay()] : shortDate(d);
  return { y, key: isoSeconds(t).slice(0, 10), label };
}

function renderYears(years) {
  return years
    .map(
      (yr) =>
        `<section class="yr"><h2 class="yr-h">${yr.y}</h2><div class="yr-b">${yr.groups
          .map((g) => {
            const lead = g.quiet ? `<p class="quiet">${g.quiet}</p>` : g.further ? `<p class="further">${FURTHER}</p>` : '';
            const cls = lead || g.dots ? 'grp gap' : 'grp';
            const items = `<ul class="its">${g.items.join('')}</ul>`;
            return g.label ? `<section class="${cls}">${lead}<h3 class="grp-h">${g.label}</h3>${items}</section>` : `<div class="${cls}">${items}</div>`;
          })
          .join('')}</div></section>`,
    )
    .join('');
}

/** Live items newest first (ties: firstSeen, then id), as in select.mjs. */
function sortLive(items, nowMs) {
  return items
    .map((it) => ({ it, t: itemTime(it, nowMs), s: toMs(it.firstSeen) ?? 0 }))
    .sort((a, b) => b.t - a.t || b.s - a.s || String(a.it.id).localeCompare(String(b.it.id)))
    .map((x) => x.it);
}

/**
 * The live stream. Quiet gaps (section 6.2.3): a gap of 7 days or more between two stories of a view (All, or
 * one tab) is written out only where that view's list is complete (at or after news.meta.completeSince), so
 * never between two picks from before the window. The first story older than the window starts its own group
 * (a group never mixes the two), headed by the FURTHER line. app.js redoes the placing for the stories a
 * filter or search leaves visible, in local time; the phrases ride on the stories as data-qa / data-qt.
 */
function renderStream(items, ctx) {
  if (!items.length) return '<p class="calm">The feeds are quiet right now. The next check is within the hour.</p>';
  const years = [];
  const last = { all: null, press: null, scene: null }; // the previous story's time in each view
  let grp = null;
  let marked = false;
  for (const it of items) {
    const t = itemTime(it, ctx.now);
    const tab = it.tab === 'press' ? 'press' : 'scene';
    const q = {};
    for (const v of ['all', tab]) {
      const days = last[v] === null ? 0 : Math.floor((last[v] - t) / DAY);
      if (days >= QUIET_DAYS && t >= ctx.complete[v]) q[v] = quietPhrase(days);
      last[v] = t;
    }
    const older = t < ctx.since;
    const g = liveGroup(t, ctx.now);
    const key = `${g.key}${older ? '<' : ''}`;
    let yr = years[years.length - 1];
    if (!yr || yr.y !== g.y) years.push((yr = { y: g.y, groups: [] }));
    if (!grp || grp.key !== key || !yr.groups.length) {
      yr.groups.push((grp = { key, label: g.label, quiet: q.all ?? '', further: older && !marked, items: [] }));
      if (older) marked = true;
    }
    grp.items.push(renderItem(it, { ...ctx, qa: q.all, qt: q[tab] }));
  }
  return renderYears(years);
}

/** Archive items grouped by year; archive.json is curated newest first, so ties keep its order. */
function renderArchive(items, nowMs) {
  const sorted = items.map((it) => ({ it, t: itemTime(it, nowMs) })).sort((a, b) => b.t - a.t);
  const years = [];
  sorted.forEach(({ it, t }, i) => {
    const y = new Date(t).getUTCFullYear();
    let yr = years[years.length - 1];
    if (!yr || yr.y !== y) years.push((yr = { y, groups: [{ label: '', dots: i > 0 && sorted[i - 1].t - t >= ARCHIVE_GAP, items: [] }] }));
    yr.groups[0].items.push(renderItem(it, { now: nowMs, archive: true, origin: i === sorted.length - 1 }));
  });
  return renderYears(years);
}

function renderSources(sources) {
  return sources
    .map((s) => {
      const st = STATUS[s.status] ? s.status : 'down';
      const home = safeUrl(s.homepage);
      const name = escapeHtml(clean(s.name) || s.id);
      const n = Number.isFinite(s.items) ? s.items : 0;
      return (
        `<li class="s-${st}"><span>${home ? `<a href="${escapeHtml(home)}" rel="noopener">${name}</a>` : name}</span>` +
        `<span>${n ? stories(n) : 'No stories'}</span><span class="s-tab">${s.tab === 'press' ? 'Press' : 'Scene'}</span><span class="s-st">${STATUS[st]}</span></li>`
      );
    })
    .join('');
}

/**
 * The footer health line. A source counts as OK only when its latest fetch worked: one the About list shows as
 * "Retrying" (stale) or "Down" does not. "Unreachable" when no source answered at the last update.
 */
export function statusLine(health) {
  const sources = Array.isArray(health?.sources) ? health.sources : [];
  const total = sources.length || (health?.summary?.total ?? 0);
  const ok = sources.length ? sources.filter((s) => s.status === 'ok').length : (health?.summary?.ok ?? 0);
  if (!total) return 'Refreshed hourly';
  if (!ok) return 'Sources unreachable right now. Showing the last update.';
  return `${ok} of ${total} sources OK · checked hourly`;
}

export function renderPage({ template, news, archive, health, site, now }) {
  const nowMs = now instanceof Date ? now.getTime() : toMs(String(now)) ?? 0;
  const cfg = site && typeof site === 'object' ? site : {};
  const base = (safeUrl(cfg.url) || 'https://wiivolve.com/').replace(/\/+$/, '');
  const name = clean(cfg.name) || 'WiiVolve';
  const since = Number.isInteger(cfg.since) ? cfg.since : 2006;
  const title = `${name} — Wii news, WiiVolving around you since ${since}`;
  const description = clean(cfg.description);
  const isItem = (it) => it && typeof it === 'object';
  const live = sortLive((Array.isArray(news?.items) ? news.items : []).filter((it) => isItem(it) && it.tab !== 'archive'), nowMs);
  const press = live.filter((it) => it.tab === 'press').length;
  const age = ageLine(nowMs, cfg.wiiLaunch);
  const generated = toMs(news?.generatedAt) ?? nowMs;
  const sources = Array.isArray(health?.sources) ? health.sources.filter(isItem) : [];
  const dolphin = news?.meta?.dolphin;
  const dolphinUrl = safeUrl(dolphin?.url);
  // The window and the complete part of each view (news.meta, section 4.2). Without them: no quiet phrases and
  // no FURTHER line, which is never untrue.
  const windowMs = toMs(news?.meta?.windowStart) ?? -Infinity;
  const cs = news?.meta?.completeSince ?? {};
  const complete = { all: toMs(cs.all) ?? Infinity, press: toMs(cs.press) ?? Infinity, scene: toMs(cs.scene) ?? Infinity };

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url: `${base}/`,
    description,
    inLanguage: 'en',
    author: { '@type': 'Person', name: clean(cfg.author) || 'Ali Kurnaz' },
    potentialAction: { '@type': 'SearchAction', target: `${base}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  }).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  const slots = {
    title: escapeHtml(title),
    description: escapeHtml(description),
    url: escapeHtml(base),
    jsonld,
    htmlClass: age.birthday ? ' class="bday"' : '',
    party: age.birthday ? '\n<link rel="stylesheet" href="/party.css" id="party">' : '',
    launch: escapeHtml(cfg.wiiLaunch || '2006-11-19'),
    age: age.html,
    tagline: escapeHtml(clean(cfg.tagline) || `WiiVolving around you since ${since}.`),
    dolphin:
      dolphinUrl && clean(dolphin.version)
        ? `<a class="dol" href="${escapeHtml(dolphinUrl)}" rel="noopener">Latest Dolphin release: <b>${escapeHtml(clean(dolphin.version))}</b></a>`
        : '',
    // The idle caption promises a glow only app.js can light, so it comes with the script; the birthday glow
    // is the server's (class="bday"), so its caption is true without JS.
    cap: age.birthday ? CAPTIONS.bday : '',
    nAll: String(live.length),
    nPress: String(press),
    nScene: String(live.length - press),
    stream: '',
    window: Number.isFinite(windowMs) ? isoSeconds(windowMs) : '',
    archive: renderArchive((Array.isArray(archive?.items) ? archive.items : []).filter(isItem), nowMs),
    sources: renderSources(sources),
    status: escapeHtml(statusLine(health)),
    generated: isoSeconds(generated),
    year: String(new Date(nowMs).getUTCFullYear()),
    author: escapeHtml(clean(cfg.author) || 'Ali Kurnaz'),
    since: String(since),
  };

  // Keep the page under its budgets (raw and gzip) even on a heavy day: shorten live excerpts step by step, then
  // drop them. Deterministic (zlib is), and a no-op on any normal day.
  const tpl = String(template ?? '');
  let html = '';
  for (const exMax of EXCERPT_STEPS) {
    slots.stream = renderStream(live, { now: nowMs, dolphin: dolphinUrl, exMax, since: windowMs, complete });
    html = tpl.replace(/<!--@(\w+)-->/g, (_, key) => slots[key] ?? '');
    if (Buffer.byteLength(html) <= PAGE_BUDGET && gzipSync(html).length <= GZIP_BUDGET) break;
  }
  return html;
}
