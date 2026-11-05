// Tolerant RSS 2.0 / RSS 1.0 (RDF) / Atom parser. Regex/scanner based; never throws.
// See docs/ARCHITECTURE.md section 5.2.
//
// parseFeed(xmlText) → { format: "rss" | "atom" | "rdf" | "unknown", title, items: [{ title, link,
//   description, content, published, updated, guid, author, sourceName, sourceUrl, categories }] }
//
// Text fields are entity-decoded. `description` and `content` hold the (raw) HTML payload: CDATA is
// taken literally, escaped markup is decoded once, inline XHTML is kept as markup. Dates are the raw
// strings from the feed (parsing happens in text.mjs).

import { decodeEntities, collapseWhitespace } from './text.mjs';

// Entries read per feed, in document order (newest first in every real feed, which carry 10 to 100). A body of
// 150,000 tiny entries fits under the 5 MB fetch cap; read whole, it cost the builder its stack (section 5.2).
export const MAX_ENTRIES = 500;
const MARK = String.fromCharCode(0);
const PLACEHOLDER = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
const EMPTY = Object.freeze({ format: 'unknown', title: '', items: [] });

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every open...close section with fn(body). Stops at the first unterminated section and leaves the
 * rest as it is, as the old lazy regexes did (no later section can be terminated either). Linear.
 */
function sections(src, open, close, fn) {
  let out = '';
  let i = 0;
  for (;;) {
    const a = src.indexOf(open, i);
    if (a === -1) break;
    const b = src.indexOf(close, a + open.length);
    if (b === -1) break;
    out += src.slice(i, a) + fn(src.slice(a + open.length, b));
    i = b + close.length;
  }
  return out + src.slice(i);
}

/**
 * Remove <!DOCTYPE ...> declarations, internal subsets included, exactly as the old regex
 * /<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/gi did, but in linear time: the regex backtracked exponentially on an
 * unterminated declaration with many "[]" pairs. The walk from a position never depends on how it got
 * there, so a position on a failed walk fails again and is never walked twice.
 */
function dropDoctypes(src) {
  if (!/<!DOCTYPE/i.test(src)) return src;
  // nextClose[i]: the first "]" at or after i, or -1. Built once, so a "[" never rescans the rest.
  const nextClose = new Int32Array(src.length + 1).fill(-1);
  for (let i = src.length - 1; i >= 0; i--) nextClose[i] = src[i] === ']' ? i : nextClose[i + 1];
  const dead = new Uint8Array(src.length + 1);
  const re = /<!DOCTYPE/gi;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const walked = [];
    let j = m.index + m[0].length;
    let end = -1;
    while (j < src.length && !dead[j]) {
      walked.push(j);
      if (src[j] === '>') {
        end = j + 1;
        break;
      }
      if (src[j] === '[') {
        const k = nextClose[j + 1];
        if (k === -1) break;
        j = k + 1;
      } else j++;
    }
    if (end === -1) {
      for (const p of walked) dead[p] = 1;
      dead[j] = 1;
      re.lastIndex = m.index + 1;
      continue;
    }
    out += src.slice(last, m.index);
    last = end;
    re.lastIndex = end;
  }
  return out + src.slice(last);
}

/** Protect CDATA sections and drop comments / DOCTYPE so the scanner only sees markup. */
function prepare(input) {
  let src = String(input ?? '')
    .replace(/^\uFEFF/, '')
    .split(MARK)
    .join('');
  const cdata = [];
  src = sections(src, '<![CDATA[', ']]>', (body) => {
    cdata.push(body);
    return `${MARK}${cdata.length - 1}${MARK}`;
  });
  src = sections(src, '<!--', '-->', () => '');
  src = dropDoctypes(src);
  return { src, cdata };
}

/** Entity-decoded text of an inner XML fragment; CDATA parts are literal. */
function textOf(inner, cdata) {
  if (!inner) return '';
  let out = '';
  let last = 0;
  PLACEHOLDER.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER.exec(inner))) {
    out += decodeEntities(inner.slice(last, m.index));
    out += cdata[Number(m[1])] ?? '';
    last = m.index + m[0].length;
  }
  out += decodeEntities(inner.slice(last));
  return out;
}

/** Inner XML fragment with CDATA restored literally and nothing decoded (inline XHTML). */
function rawOf(inner, cdata) {
  return (inner || '').replace(PLACEHOLDER, (_, i) => cdata[Number(i)] ?? '');
}

/** Parse the attributes of a start tag into an object with lowercase names and decoded values. */
function parseAttrs(str) {
  const attrs = {};
  if (!str) return attrs;
  const re = /([A-Za-z_][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Find the first element `qname` (case-insensitive, exact prefix) in `block`.
 * Tolerates a missing close tag (content runs to the next tag). Returns { attrs, inner, start, end } or null.
 */
function findElement(block, qname, from = 0, memo = null) {
  const open = new RegExp(`<${escapeRe(qname)}(?=[\\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  open.lastIndex = from;
  const m = open.exec(block);
  if (!m) return null;
  let attrStr = m[1];
  const afterOpen = open.lastIndex;
  if (/\/\s*$/.test(attrStr)) {
    attrStr = attrStr.replace(/\/\s*$/, '');
    return { attrs: parseAttrs(attrStr), inner: '', start: m.index, end: afterOpen };
  }
  const close = new RegExp(`</${escapeRe(qname)}\\s*>`, 'gi');
  close.lastIndex = afterOpen;
  const c = memo && afterOpen >= memo.noCloseFrom ? null : close.exec(block);
  if (!c && memo) memo.noCloseFrom = Math.min(memo.noCloseFrom, afterOpen);
  if (c) return { attrs: parseAttrs(attrStr), inner: block.slice(afterOpen, c.index), start: m.index, end: close.lastIndex };
  const rest = block.slice(afterOpen);
  const lt = rest.indexOf('<');
  const inner = lt === -1 ? rest : rest.slice(0, lt);
  return { attrs: parseAttrs(attrStr), inner, start: m.index, end: afterOpen + inner.length };
}

function findAll(block, qname) {
  const out = [];
  let from = 0;
  const memo = { noCloseFrom: Infinity };
  for (;;) {
    const el = findElement(block, qname, from, memo);
    if (!el) break;
    out.push(el);
    from = Math.max(el.end, el.start + 1);
  }
  return out;
}

/**
 * Remove an element (all occurrences) from a block, returning the first one found and the remainder, in one
 * pass: rebuilding the rest once per occurrence was quadratic in an entry that repeats one element.
 */
function takeElement(block, qname) {
  const all = findAll(block, qname);
  if (!all.length) return { el: null, rest: block };
  const parts = [];
  let last = 0;
  for (const el of all) {
    parts.push(block.slice(last, el.start), ' ');
    last = el.end;
  }
  parts.push(block.slice(last));
  return { el: all[0], rest: parts.join('') };
}

/** Links the way browsers read them: trimmed, with ASCII tabs and newlines removed anywhere. */
function cleanLink(s) {
  return String(s || '').replace(/[\t\n\r]/g, '').trim();
}

function firstText(block, names, cdata) {
  for (const n of names) {
    const el = findElement(block, n);
    if (el) {
      const t = collapseWhitespace(textOf(el.inner, cdata));
      if (t) return t;
    }
  }
  return '';
}

/** Split the document into item blocks (the first `limit`): from each start tag to its close tag, the next start, or the end. */
function itemBlocks(src, tagPattern, closePattern, limit) {
  const starts = [];
  const re = new RegExp(`<(${tagPattern})(?=[\\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  let m;
  while ((m = re.exec(src))) starts.push({ index: m.index, bodyStart: re.lastIndex, attrs: m[2], selfClosing: /\/\s*$/.test(m[2]) });
  const blocks = [];
  for (let i = 0; i < starts.length && blocks.length < limit; i++) {
    const s = starts[i];
    if (s.selfClosing) continue;
    const limit = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const close = new RegExp(closePattern, 'gi');
    const body = src.slice(s.bodyStart, limit);
    const c = close.exec(body);
    const end = c ? s.bodyStart + c.index : limit;
    blocks.push({ attrs: parseAttrs(s.attrs.replace(/\/\s*$/, '')), body: src.slice(s.bodyStart, end) });
  }
  return { blocks, firstIndex: starts.length ? starts[0].index : src.length };
}

function detectFormat(src) {
  const root = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)(?=[\s/>])/.exec(sections(src, '<?', '?>', () => ''));
  const local = root ? root[2].toLowerCase() : '';
  if (local === 'rss') return 'rss';
  if (local === 'rdf') return 'rdf';
  if (local === 'feed') return 'atom';
  if (local === 'channel') return 'rss';
  if (local === 'html' || local === 'body' || local === 'head') return 'unknown';
  if (/<rdf:RDF[\s>]/i.test(src) && /<item[\s>]/i.test(src)) return 'rdf';
  if (/<rss[\s>]/i.test(src) || (/<channel[\s>]/i.test(src) && /<item[\s>]/i.test(src))) return 'rss';
  if (/<feed[\s>]/i.test(src) || /<entry[\s>]/i.test(src)) return 'atom';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------

function parseRssItem(body, cdata, format, itemAttrs) {
  const desc = takeElement(body, 'description');
  const encoded = takeElement(desc.rest, 'content:encoded');
  let rest = encoded.rest;
  const description = desc.el ? textOf(desc.el.inner, cdata).trim() : '';
  const content = encoded.el ? textOf(encoded.el.inner, cdata).trim() : '';

  const source = takeElement(rest, 'source');
  rest = source.rest;

  // Link: feedburner's original link, the RSS <link>, an Atom link, a permalink guid, rdf:about.
  const orig = findElement(rest, 'feedburner:origLink');
  let link = orig ? cleanLink(textOf(orig.inner, cdata)) : '';
  if (!link) {
    for (const el of findAll(rest, 'link')) {
      const t = cleanLink(textOf(el.inner, cdata));
      if (t) {
        link = t;
        break;
      }
      if (el.attrs.href && (!el.attrs.rel || el.attrs.rel === 'alternate')) {
        link = el.attrs.href;
        break;
      }
    }
  }
  if (!link) {
    for (const el of findAll(rest, 'atom:link')) {
      if (el.attrs.href && (!el.attrs.rel || el.attrs.rel === 'alternate')) {
        link = el.attrs.href;
        break;
      }
    }
  }
  const guidEl = findElement(rest, 'guid');
  const guid = guidEl ? collapseWhitespace(textOf(guidEl.inner, cdata)) : '';
  if (!link && guid && guidEl.attrs.ispermalink !== 'false' && /^https?:\/\//i.test(guid)) link = guid;
  if (!link && itemAttrs['rdf:about']) link = itemAttrs['rdf:about'];

  const categories = [...findAll(rest, 'category'), ...findAll(rest, 'dc:subject')]
    .map((el) => collapseWhitespace(textOf(el.inner, cdata)) || el.attrs.term || '')
    .filter(Boolean);

  return {
    title: firstText(rest, ['title', 'dc:title'], cdata),
    link: cleanLink(link),
    description,
    content,
    published: firstText(rest, ['pubDate', 'dc:date', 'dcterms:issued', 'published', 'atom:published', 'dcterms:created'], cdata),
    updated: firstText(rest, ['atom:updated', 'updated', 'dcterms:modified', 'dc:modified'], cdata),
    guid: guid || (format === 'rdf' ? itemAttrs['rdf:about'] || '' : ''),
    author: firstText(rest, ['dc:creator', 'author', 'itunes:author'], cdata),
    sourceName: source.el ? collapseWhitespace(textOf(source.el.inner, cdata)) : '',
    sourceUrl: source.el ? source.el.attrs.url || '' : '',
    categories,
  };
}

function atomLink(block) {
  const links = [...findAll(block, 'link'), ...findAll(block, 'atom:link')];
  const alternates = links.filter((l) => l.attrs.href && (!l.attrs.rel || l.attrs.rel.toLowerCase() === 'alternate'));
  const html = alternates.find((l) => !l.attrs.type || /html/i.test(l.attrs.type));
  const pick = html || alternates[0] || links.find((l) => l.attrs.href);
  return pick ? cleanLink(pick.attrs.href) : '';
}

function atomPayload(el, cdata) {
  if (!el) return '';
  const type = (el.attrs.type || '').toLowerCase();
  if (type === 'xhtml' || /xhtml\+xml/.test(type)) return rawOf(el.inner, cdata).trim();
  return textOf(el.inner, cdata).trim();
}

function atomTitle(el, cdata) {
  if (!el) return '';
  const type = (el.attrs.type || '').toLowerCase();
  return collapseWhitespace(type === 'xhtml' ? rawOf(el.inner, cdata) : textOf(el.inner, cdata));
}

function parseAtomEntry(body, cdata) {
  const summary = takeElement(body, 'summary');
  const contentEl = takeElement(summary.rest, 'content');
  let rest = contentEl.rest;
  const source = takeElement(rest, 'source');
  rest = source.rest;
  const authorEl = findElement(rest, 'author');
  const author = authorEl ? firstText(authorEl.inner, ['name'], cdata) || collapseWhitespace(textOf(authorEl.inner, cdata)) : '';
  const categories = findAll(rest, 'category')
    .map((el) => el.attrs.label || el.attrs.term || collapseWhitespace(textOf(el.inner, cdata)))
    .filter(Boolean);
  let sourceName = '';
  let sourceUrl = '';
  if (source.el) {
    sourceName = atomTitle(findElement(source.el.inner, 'title'), cdata);
    sourceUrl = atomLink(source.el.inner) || firstText(source.el.inner, ['id'], cdata);
  }
  return {
    title: atomTitle(findElement(rest, 'title'), cdata),
    link: atomLink(rest),
    description: atomPayload(summary.el, cdata),
    content: atomPayload(contentEl.el, cdata),
    published: firstText(rest, ['published', 'issued', 'dc:date', 'created'], cdata),
    updated: firstText(rest, ['updated', 'modified'], cdata),
    guid: firstText(rest, ['id'], cdata),
    author,
    sourceName,
    sourceUrl,
    categories,
  };
}

/** Parse a feed document. Never throws; anything unrecognisable gives { format: "unknown", items: [] }. */
export function parseFeed(xmlText) {
  try {
    const { src, cdata } = prepare(xmlText);
    const format = detectFormat(src);
    if (format === 'unknown') return { ...EMPTY, items: [] };
    let items = [];
    let header = src;
    if (format === 'atom') {
      const { blocks, firstIndex } = itemBlocks(src, '(?:atom:)?entry', '</(?:atom:)?entry\\s*>', MAX_ENTRIES);
      header = src.slice(0, firstIndex);
      items = blocks.map((b) => parseAtomEntry(b.body, cdata));
    } else {
      const tag = format === 'rdf' ? '(?:[A-Za-z_][\\w.-]*:)?item' : 'item';
      const close = format === 'rdf' ? '</(?:[A-Za-z_][\\w.-]*:)?item\\s*>' : '</item\\s*>';
      const { blocks, firstIndex } = itemBlocks(src, tag, close, MAX_ENTRIES);
      header = src.slice(0, firstIndex);
      items = blocks.map((b) => parseRssItem(b.body, cdata, format, b.attrs));
    }
    const titleEl = findElement(header, 'title');
    const title = titleEl ? collapseWhitespace(textOf(titleEl.inner, cdata)) : '';
    return { format, title, items };
  } catch {
    return { ...EMPTY, items: [] };
  }
}
