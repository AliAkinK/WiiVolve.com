// Text normalization: entity decoding, HTML stripping, truncation, URLs, dates, per-source rules.
// See docs/ARCHITECTURE.md section 5.3. Node built-ins only.

import { CP1252_80_9F } from './util.mjs';

// ---------------------------------------------------------------------------------------------
// Entities

// HTML 4.01 named entities plus the HTML5 names that show up in feeds. Values are code points.
const NAMED = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, QUOT: 34, AMP: 38, LT: 60, GT: 62,
  nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168,
  copy: 169, COPY: 169, ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, REG: 174, macr: 175, deg: 176,
  plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185,
  ordm: 186, raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193,
  Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201,
  Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210,
  Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218,
  Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224, aacute: 225, acirc: 226,
  atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233, ecirc: 234,
  euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242,
  oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250,
  ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  Alpha: 913, Beta: 914, Gamma: 915, Delta: 916, Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921,
  Kappa: 922, Lambda: 923, Mu: 924, Nu: 925, Xi: 926, Omicron: 927, Pi: 928, Rho: 929, Sigma: 931, Tau: 932,
  Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937, alpha: 945, beta: 946, gamma: 947, delta: 948,
  epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954, lambda: 955, mu: 956, nu: 957,
  xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963, tau: 964, upsilon: 965, phi: 966,
  chi: 967, psi: 968, omega: 969, thetasym: 977, upsih: 978, piv: 982,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, hyphen: 8208, dash: 8208,
  ndash: 8211, mdash: 8212, horbar: 8213, lsquo: 8216, rsquo: 8217, rsquor: 8217, sbquo: 8218, ldquo: 8220,
  rdquo: 8221, rdquor: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, bullet: 8226,
  hellip: 8230, mldr: 8230, nldr: 8229, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250,
  oline: 8254, frasl: 8260, euro: 8364, image: 8465, weierp: 8472, real: 8476, trade: 8482, TRADE: 8482,
  alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629, lArr: 8656,
  uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660, forall: 8704, part: 8706, exist: 8707, empty: 8709,
  nabla: 8711, isin: 8712, notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722, lowast: 8727,
  radic: 8730, prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747,
  there4: 8756, sim: 8764, cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834,
  sup: 8835, nsub: 8836, sube: 8838, supe: 8839, oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901,
  lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971, lang: 9001, rang: 9002, loz: 9674, spades: 9824,
  clubs: 9827, hearts: 9829, diams: 9830, star: 9734, starf: 9733, check: 10003, cross: 10007,
  excl: 33, num: 35, dollar: 36, percnt: 37, lpar: 40, rpar: 41, ast: 42, plus: 43, comma: 44, period: 46,
  sol: 47, colon: 58, semi: 59, equals: 61, quest: 63, commat: 64, lsqb: 91, lbrack: 91, bsol: 92, rsqb: 93,
  rbrack: 93, Hat: 94, lowbar: 95, grave: 96, lcub: 123, lbrace: 123, verbar: 124, vert: 124, rcub: 125,
  rbrace: 125, Tab: 9, NewLine: 10,
};

function fromCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD';
  if (n >= 0x80 && n <= 0x9f) return String.fromCodePoint(CP1252_80_9F[n - 0x80]);
  return String.fromCodePoint(n);
}

/** Decode named (HTML) and numeric character references. Unknown entities are left as they are. */
export function decodeEntities(input) {
  const s = String(input ?? '');
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec, hex, name) => {
    if (dec) return fromCodePoint(parseInt(dec, 10));
    if (hex) return fromCodePoint(parseInt(hex, 16));
    const cp = Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : undefined;
    return cp === undefined ? m : String.fromCodePoint(cp);
  });
}

// ---------------------------------------------------------------------------------------------
// Whitespace, tags, truncation

/** Collapse runs of whitespace (including NBSP and other Unicode spaces) and remove zero-width characters. */
export function collapseWhitespace(input) {
  return String(input ?? '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, ' ')
    .trim();
}

// Open-tag patterns: the unquoted part of a tag never runs past a "<", so a stray "<a" costs one step to
// the next "<", not a scan to the end (quadratic on hostile input). Quoted values may hold "<" and ">".
// A tag, allowing ">" inside quoted attribute values. The name is taken whole (the lookahead): the attribute
// part also matches name characters, so without it a never-closed "<abbb…" was retried at every split of
// its name, quadratic in the name's length.
const TAG = /<\/?[A-Za-z][A-Za-z0-9:-]*(?![A-Za-z0-9:-])(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
// Elements whose content is never readable text, removed with their content by dropBlocks().
const DROP_OPEN = /<(script|style|noscript|template|iframe|object|svg|math|head|header|figcaption|button|select|textarea)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
// Tags that separate words visually.
const BREAKS = /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|figure|hr|section|article|aside|footer|center|dd|dt|dl|pre)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
// Longest HTML payload looked at per entry; beyond it nothing is excerpted or keyword-matched.
const STRIP_MAX = 256 * 1024;
// A block break in excerpt text until cleanExcerpt joins the blocks. "\s" and "." both match a form feed, as
// they matched the space that stood here before, so the boilerplate patterns read the text as they did.
const BLOCK = '\f';
const SPACES = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/**
 * Remove each DROP_OPEN element up to its first matching close tag, with its content, as the old lazy regex
 * /<(script|...)\b...>[\s\S]*?<\/\1\s*>/gi did. Linear: once a name has no close tag after some position,
 * no later opener of that name searches again.
 */
function dropBlocks(s) {
  const noCloseFrom = new Map(); // lowercase name -> position after which no close tag exists
  let out = '';
  let last = 0;
  let m;
  DROP_OPEN.lastIndex = 0;
  while ((m = DROP_OPEN.exec(s))) {
    const name = m[1].toLowerCase();
    const bodyStart = DROP_OPEN.lastIndex;
    let end = -1;
    if (bodyStart < (noCloseFrom.get(name) ?? Infinity)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi');
      close.lastIndex = bodyStart;
      if (close.exec(s)) end = close.lastIndex;
      else noCloseFrom.set(name, bodyStart);
    }
    if (end === -1) {
      DROP_OPEN.lastIndex = m.index + 1;
      continue;
    }
    out += `${s.slice(last, m.index)} `;
    last = end;
    DROP_OPEN.lastIndex = end;
  }
  return out + s.slice(last);
}

/** Remove every open...close section (processing instructions); stops at the first unterminated one. Linear. */
function removeSections(s, open, close) {
  let out = '';
  let last = 0;
  for (;;) {
    const a = s.indexOf(open, last);
    if (a === -1) break;
    const b = s.indexOf(close, a + open.length);
    if (b === -1) break;
    out += s.slice(last, a);
    last = b + close.length;
  }
  return out + s.slice(last);
}

/**
 * HTML → plain text. With `blocks`, every block break (a block tag such as </p>, <br> or </li>, and in a field
 * without any markup a newline) becomes BLOCK, with the whitespace around it; in HTML a newline is only a space,
 * as a browser shows it.
 */
function htmlText(html, blocks) {
  let s = String(html ?? '').slice(0, STRIP_MAX);
  const plain = blocks && !/<[A-Za-z!/?]/.test(s);
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  s = s.replace(/<!\[CDATA\[|\]\]>/g, '');
  s = dropBlocks(s);
  s = s.replace(BREAKS, blocks ? BLOCK : ' ');
  s = s.replace(TAG, '');
  s = s.replace(/<![A-Za-z][^<>]*>/g, '');
  s = removeSections(s, '<?', '?>');
  s = decodeEntities(s);
  if (!blocks) return collapseWhitespace(s);
  if (plain) s = s.replace(/\r\n?|\n/g, BLOCK);
  return s.replace(INVISIBLE, '').replace(SPACES, (m) => (m.includes(BLOCK) ? BLOCK : ' ')).trim();
}

/** HTML → plain text: drops comments, scripts, headers and captions, strips tags, decodes entities, collapses whitespace. */
export function stripTags(html) {
  return htmlText(html, false);
}

// A block that ends in one of these (optionally followed by closing quotes or brackets) ends its own clause.
const CLAUSE_END = new Set([...'.!?…:;,–—-']);
const CLOSERS = new Set([...'"\'”’»)]}']);
const endsClause = (run) => {
  let i = run.length - 1;
  while (i > 0 && CLOSERS.has(run[i])) i--;
  return CLAUSE_END.has(run[i]);
};

/**
 * Excerpt text with BLOCK breaks → one line. Two blocks are joined with " — " unless the first ends its clause
 * ("make this game No, I have no clue" read as one sentence) or the second starts with a dash; then with a space.
 * Linear: each block is looked at once.
 */
function joinBlocks(text) {
  const parts = [];
  let prev = '';
  for (const block of text.split(BLOCK)) {
    const run = collapseWhitespace(block);
    if (!run) continue;
    if (prev) parts.push(endsClause(prev) || '–—-'.includes(run[0]) ? ' ' : ' — ');
    parts.push(run);
    prev = run;
  }
  return parts.join('');
}

// Inline tags that may appear in titles. Only these are stripped from titles, so a title like
// "Is this <insert game> worth it?" keeps its words.
const TITLE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|big|br|cite|code|del|dfn|div|em|font|i|img|ins|kbd|mark|nobr|p|q|s|samp|small|span|strike|strong|sub|sup|time|tt|u|var|wbr)\b(?:[^<>"']|"[^"]*"|'[^']*')*\/?>/gi;

/**
 * Cut `text` to at most `max` UTF-16 code units on a word boundary, ending with "…" when shortened.
 * Never splits a surrogate pair. Trailing punctuation before the ellipsis is dropped.
 */
export function truncate(input, max, ellipsis = '…') {
  const text = String(input ?? '');
  if (text.length <= max) return text;
  let room = Math.max(1, max - ellipsis.length);
  if (/[\uD800-\uDBFF]/.test(text[room - 1] || '')) room -= 1;
  let cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s,;:.\-–—…|/(\[{'"“‘]+$/u, '');
  return cut + ellipsis;
}

export const TITLE_MAX = 200;
export const EXCERPT_MAX = 220;

/** Feed title → plain text without the length cap: inline tags stripped, entities decoded, whitespace collapsed. */
export function titleText(raw) {
  return collapseWhitespace(decodeEntities(String(raw ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(TITLE_TAG, ' ')));
}

/** Feed title → display title: strip inline tags, decode entities (again, for double-encoded feeds), collapse, cap 200. */
export function cleanTitle(raw) {
  return truncate(titleText(raw), TITLE_MAX);
}

// Boilerplate found at the end (or inside) of feed excerpts. Applied to plain text, case-insensitive.
export const COMMON_STRIP = [
  'Read the full article on \\S+',
  'The post .{1,300}? appeared first on .{1,160}?\\.?\\s*$',
  'Continue reading\\b.*$',
  '(?:…|\\.\\.\\.)?\\s*Read more\\s*(?:»|›|→|\\.\\.\\.|…)?\\s*$',
  '(?:…|\\.\\.\\.)?\\s*\\(?(?:Read|View) (?:the )?(?:full|whole|entire) (?:story|post|article)\\)?\\s*(?:»|›|→)?\\s*$',
  // Reddit: "submitted by /u/name [link] [comments]"
  'submitted by\\s+/?u/[\\w-]+(?:\\s+to\\s+/?r/\\w+)?\\s*(?:\\[link\\])?\\s*(?:\\[comments\\])?',
];

function compileStrip(patterns) {
  const out = [];
  for (const p of patterns || []) {
    try {
      out.push(new RegExp(p, 'giu'));
    } catch {
      // An invalid pattern in feeds.json is ignored rather than crashing the build.
    }
  }
  return out;
}
const COMMON_STRIP_RE = compileStrip(COMMON_STRIP);

// A source's own "…read more" / "[…]" means its teaser was already cut: keep an ellipsis.
const SOURCE_CUT = /(?:…|\.\.\.)\s*(?:read more|continue reading)\b.*$|\s*\[(?:…|\.\.\.)\]\s*$/iu;

/**
 * Feed description/content HTML → excerpt: plain text, boilerplate removed, ≤ 220 chars ending in "…" when cut.
 * Returns "" when nothing useful remains or the text only repeats the title.
 */
export function cleanExcerpt(html, { strip = [], title = '' } = {}) {
  let s = htmlText(html, true);
  let cutBySource = false;
  for (const re of compileStrip(strip)) s = s.replace(re, ' ');
  if (SOURCE_CUT.test(s)) {
    cutBySource = true;
    s = s.replace(SOURCE_CUT, '');
  }
  for (const re of COMMON_STRIP_RE) s = s.replace(re, ' ');
  s = trimTrailing(joinBlocks(s).replace(/^[\s|:;,.\-–—•]+/u, ''));
  if (cutBySource && s && !/[.!?…"”’)]$/u.test(s)) s += '…';
  if (!s || s === '…') return '';
  if (title) {
    const tk = titleKey(title);
    const sk = titleKey(s);
    if (tk && (sk === tk || (sk.startsWith(tk) && sk.length - tk.length < 40))) return '';
  }
  return truncate(s, EXCERPT_MAX);
}

const TRAILING = new Set([...'|:;,-–—•']);

/**
 * Drop trailing separators and turn a trailing run of 3+ dots (or a lone "…") into one "…", with the
 * whitespace before it removed. The same result as .replace(/[\s|:;,\-–—•]+$/u, '').replace(/\s*(?:\.{3,}|…)$/u, '…')
 * in linear time: those end-anchored regexes rescanned every run of separators or dots (quadratic on
 * a 40,000-character Reddit post of hyphens).
 */
function trimTrailing(input) {
  let end = input.length;
  while (end > 0 && (TRAILING.has(input[end - 1]) || /\s/.test(input[end - 1]))) end--;
  const s = input.slice(0, end);
  let cut = end;
  if (s.endsWith('…')) cut = end - 1;
  else {
    while (cut > 0 && s[cut - 1] === '.') cut--;
    if (end - cut < 3) cut = end;
  }
  if (cut === end) return s;
  while (cut > 0 && /\s/.test(s[cut - 1])) cut--;
  return `${s.slice(0, cut)}…`;
}

/** Lowercase, accents folded, apostrophes dropped, other punctuation as spaces. */
export function foldText(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’'`ʼ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One regex matching a trailing " - Name" / " | Name" for any of the publisher names (longest first). */
export function publisherSuffixPattern(names = []) {
  const list = [...new Set(names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`\\s+[-–—|:]\\s+(?:${list.map(escapeRe).join('|')})\\s*$`, 'iu');
}

/**
 * Dedupe key for a title: a trailing " - Publisher" (or " | Publisher") is removed for any of
 * the given names (an array, or a pattern from publisherSuffixPattern), then the text is folded
 * (lowercase, accents and punctuation removed).
 */
export function titleKey(title, names = []) {
  const re = names instanceof RegExp ? names : publisherSuffixPattern(names);
  const t = String(title ?? '');
  return foldText(re ? t.replace(re, '') : t);
}

// ---------------------------------------------------------------------------------------------
// URLs

const TRACKING_PARAM = /^(?:utm_[a-z0-9_]*|fbclid|gclid|mc_cid|mc_eid)$/i;

function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/**
 * Canonical item URL, or null if it is not http(s). Resolves relative links against `base`,
 * lowercases the host, drops credentials and the tracking parameters utm_*, fbclid, gclid,
 * mc_cid, mc_eid. Everything else (other parameters, their encoding, the fragment) is kept.
 */
export function canonicalUrl(raw, base) {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  let u;
  try {
    u = base ? new URL(str, base) : new URL(str);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  u.username = '';
  u.password = '';
  if (u.search && u.search.length > 1) {
    const parts = u.search.slice(1).split('&');
    const kept = parts.filter((p) => {
      if (!p) return false;
      const key = safeDecode(p.split('=')[0]);
      return !TRACKING_PARAM.test(key);
    });
    if (kept.length !== parts.length) u.search = kept.length ? `?${kept.join('&')}` : '';
  }
  return u.href;
}

/** True for absolute http(s) URLs. */
export function isHttpUrl(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Dates

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10,
  november: 10, dec: 11, december: 11,
};
// Offsets in minutes.
const ZONES = {
  ut: 0, utc: 0, gmt: 0, z: 0, wet: 0, west: 60, bst: 60, cet: 60, cest: 120, met: 60, mest: 120, eet: 120,
  eest: 180, msk: 180, ist: 330, sgt: 480, hkt: 480, jst: 540, kst: 540, aest: 600, aedt: 660, acst: 570,
  acdt: 630, awst: 480, nzst: 720, nzdt: 780, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420,
  mdt: -360, pst: -480, pdt: -420, akst: -540, akdt: -480, hst: -600, ast: -240, adt: -180, nst: -210,
  ndt: -150,
};

function offsetMinutes(zone) {
  if (!zone) return 0;
  const z = zone.trim();
  const num = /^([+-])(\d{2}):?(\d{2})?$/.exec(z);
  if (num) return (num[1] === '-' ? -1 : 1) * (parseInt(num[2], 10) * 60 + parseInt(num[3] || '0', 10));
  const named = ZONES[z.toLowerCase()];
  return named === undefined ? 0 : named;
}

function build(y, mo, d, h, mi, s, ms, zone) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return null;
  const t = Date.UTC(y, mo, d, h, mi, Math.min(s, 59), ms) - offsetMinutes(zone) * 60e3;
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCMonth() !== mo) return null; // 31 Feb and friends
  return Number.isFinite(t) ? t : null;
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$/;
const WEEKDAY = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s*)?';
const RFC822_RE = new RegExp(`^${WEEKDAY}(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+([A-Za-z]{3,9})\\.?,?[\\s-]+(\\d{2,4})(?:[\\s,T]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\s*([AaPp][Mm]))?)?\\s*([+-]\\d{2}:?\\d{2}|[A-Za-z]{1,5})?$`, 'i');
const US_RE = new RegExp(`^${WEEKDAY}([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?:[\\s,T]+(?:at\\s+)?(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\s*([AaPp][Mm]))?)?\\s*([+-]\\d{2}:?\\d{2}|[A-Za-z]{1,5})?$`, 'i');

function hour12(h, ampm) {
  if (!ampm) return h;
  const pm = /p/i.test(ampm);
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

/**
 * Parse RFC 822/2822, ISO 8601/RFC 3339 and a few common variants to epoch ms (UTC when no zone
 * is given). Returns null for anything unparseable or before 1990.
 */
export function parseDate(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).slice(0, 200).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let t = null;
  let m = ISO_RE.exec(s);
  if (m) {
    const ms = m[7] ? Math.round(parseFloat(`0.${m[7]}`) * 1000) : 0;
    t = build(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms, m[8]);
  } else if ((m = RFC822_RE.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()];
    let y = +m[3];
    if (m[3].length <= 2) y += y < 50 ? 2000 : 1900;
    if (mo !== undefined) t = build(y, mo, +m[1], hour12(+(m[4] || 0), m[7]), +(m[5] || 0), +(m[6] || 0), 0, m[8]);
  } else if ((m = US_RE.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) t = build(+m[3], mo, +m[2], hour12(+(m[4] || 0), m[7]), +(m[5] || 0), +(m[6] || 0), 0, m[8]);
  }
  if (t === null || !Number.isFinite(t)) return null;
  if (t < Date.UTC(1990, 0, 1)) return null;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Publishers and per-source normalization

export const PUBLISHER_MAX = 100;

/** "www.wargamer.com" → "wargamer.com"; inline tags stripped, entities decoded, whitespace collapsed, ≤ 100 chars. */
export function prettifyPublisher(name) {
  return truncate(titleText(name).replace(/^www\./i, ''), PUBLISHER_MAX);
}

/**
 * Split a Google News title "Headline - Publisher". With a known publisher (from <source>) only that
 * exact suffix is removed; without one, the last " - " followed by a short name is taken as the publisher.
 */
export function splitPublisherSuffix(title, publisher) {
  const t = String(title ?? '').trim();
  if (publisher) {
    const re = new RegExp(`\\s+[-–—|]\\s+${escapeRe(publisher)}\\s*$`, 'iu');
    return { headline: re.test(t) ? t.replace(re, '').trim() : t, publisher };
  }
  const m = /^(.*\S)\s+[-–—]\s+([^-–—]{2,80})$/u.exec(t);
  if (m) return { headline: m[1].trim(), publisher: m[2].trim() };
  return { headline: t, publisher: '' };
}

/**
 * The plain text the keyword filter reads: description and content, but the content alone when it already
 * holds the description. WordPress feeds (Hackaday) put the start of the post in <description> and the whole
 * post in <content:encoded>, so joining both counted one mention in the first paragraph twice, enough for the
 * two-mention body rule (section 5.4).
 */
export function matchText(raw) {
  const description = stripTags(raw.description);
  const content = stripTags(raw.content);
  if (!description || !content) return description || content;
  // The teaser's first 120 characters, without the "[…]" or "…" WordPress puts at its end.
  const probe = description.slice(0, 120).replace(/\s*(?:\[(?:…|\.\.\.)\]|…|\.\.\.)\s*$/u, '');
  return content.includes(probe) ? content : `${description} ${content}`;
}

/**
 * Normalize one parsed feed entry for a source. Relative links resolve against `base`: the feed's address
 * after redirects when it was fetched, else the configured url.
 * Returns null when the entry has no usable http(s) link or no title; otherwise
 * { title, url, source, via, excerpt, published (ms|null), text } where `text` is the full
 * plain-text description + content used for keyword matching.
 */
export function normalizeEntry(raw, source, base = source.url) {
  const url = canonicalUrl(raw.link, base || source.url);
  if (!url) return null;
  let title;
  let publisher = source.name;
  let via;
  if (source.aggregator) {
    const named = raw.sourceName ? titleText(raw.sourceName) : '';
    const split = splitPublisherSuffix(titleText(raw.title), named);
    title = truncate(split.headline, TITLE_MAX);
    publisher = prettifyPublisher(named || split.publisher) || source.name;
    via = source.name;
  } else {
    title = cleanTitle(raw.title);
  }
  if (!title) return null;
  const text = matchText(raw);
  let excerpt = '';
  if (!source.aggregator) {
    excerpt = cleanExcerpt(raw.description, { strip: source.strip, title });
    if (!excerpt && raw.content) excerpt = cleanExcerpt(raw.content, { strip: source.strip, title });
  }
  const published = parseDate(raw.published) ?? parseDate(raw.updated);
  return { title, url, source: publisher, via, excerpt, published, text };
}
