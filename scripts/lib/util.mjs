// Small shared helpers: hashing, stable JSON, ISO dates, atomic writes, XML escaping.
// Node built-ins only. See docs/ARCHITECTURE.md sections 4 and 5.

import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

/** sha256 of a string or Buffer, as lowercase hex. */
export function sha256Hex(input) {
  return createHash('sha256').update(input ?? '').digest('hex');
}

/** Live item id: the first 12 hex chars of sha256(canonical URL). */
export function itemId(canonicalUrl) {
  return sha256Hex(String(canonicalUrl)).slice(0, 12);
}

/**
 * JSON.stringify with object keys sorted at every level, so equal data always
 * serialises to the same string. Arrays keep their order. `undefined` values are
 * dropped (as JSON.stringify does); non-finite numbers become null.
 */
export function stableJSON(value, space) {
  return JSON.stringify(sortKeys(value), null, space);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

/** ISO 8601 UTC with second precision and a Z suffix: 2026-11-04T16:17:00Z. Null for invalid input. */
export function isoSeconds(date) {
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse one of our own ISO strings (or anything Date understands strictly) to epoch ms, NaN if invalid. */
export function toMs(iso) {
  if (iso instanceof Date) return iso.getTime();
  if (typeof iso !== 'string' || !iso) return NaN;
  return Date.parse(iso);
}

/** UTC calendar day, YYYY-MM-DD. */
export function utcDay(date) {
  const iso = isoSeconds(date);
  return iso ? iso.slice(0, 10) : null;
}

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

let tmpCounter = 0;

/** Write a file atomically: write a temp file next to it, then rename over the target. */
export async function atomicWrite(file, content) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${++tmpCounter}.tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Read and parse a JSON file; return `fallback` when it is missing or unreadable. */
export async function readJSON(file, fallback = null) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

/**
 * JSON.parse that also accepts // and /* *\/ comments and trailing commas outside strings, so an annotated
 * feeds.json (like the example in docs/ARCHITECTURE.md section 3) still loads. One left-to-right scan, so
 * string contents are never touched (a regex such as "\\d{2,}" survives) and a quote inside a comment is
 * just text. Throws SyntaxError on anything else that is not JSON.
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

/** Read a text file, or null when it does not exist. */
export async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for XML element content and attribute values. Also removes characters
 * that are not allowed in XML 1.0 at all (C0 controls other than tab/LF/CR, lone surrogates, U+FFFE/U+FFFF).
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** Pause for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * windows-1252 code points for bytes 0x80–0x9F (the only range where it differs from ISO-8859-1).
 * Undefined positions map to the C1 control of the same value, as the WHATWG decoder does.
 * Also used for numeric character references in that range (HTML treats &#150; as an en dash).
 */
export const CP1252_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** Decode windows-1252 bytes without relying on ICU data being present. */
export function decodeWindows1252(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    const slice = bytes.subarray(i, i + 4096);
    const codes = new Array(slice.length);
    for (let j = 0; j < slice.length; j++) {
      const b = slice[j];
      codes[j] = b >= 0x80 && b <= 0x9f ? CP1252_80_9F[b - 0x80] : b;
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}
