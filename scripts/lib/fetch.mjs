// Polite feed fetching: timeouts, conditional requests, one retry, size cap, charset decoding.
// See docs/ARCHITECTURE.md section 5.1. Node built-ins only (global fetch, Node 22+).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeWindows1252, sleep } from './util.mjs';

/** A current desktop Chrome UA, sent to sources configured with "userAgent": "browser" (Reddit). */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
export const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';
export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 15000;
export const RETRY_DELAY_MS = 2000;
/** Gap between two requests to the same host (r/wii and r/WiiHacks share reddit.com, which rate-limits). */
export const HOST_GAP_MS = 3000;
/**
 * Longest wait honoured from a rate-limit header before the next same-host request. Reddit answers an
 * unauthenticated .rss request with x-ratelimit-remaining: 0 and x-ratelimit-reset: ~60 (one request per
 * minute), so the second subreddit is fetched once the window resets.
 */
export const MAX_RATE_WAIT_MS = 65000;

/** Rate-limit hints from a response: x-ratelimit-remaining / x-ratelimit-reset (seconds) and Retry-After. */
export function rateLimitOf(headers) {
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  let retryAfter = null;
  const ra = headers?.get?.('retry-after');
  if (ra) {
    if (Number.isFinite(Number(ra))) retryAfter = Number(ra);
    else if (Number.isFinite(Date.parse(ra))) retryAfter = Math.max(0, Math.round((Date.parse(ra) - Date.now()) / 1000));
  }
  return { remaining: num(headers?.get?.('x-ratelimit-remaining')), reset: num(headers?.get?.('x-ratelimit-reset')), retryAfter };
}

/** How long to wait before the next request to the same host, given the previous result. */
export function nextRequestDelay(result, { hostGapMs = HOST_GAP_MS, maxRateWaitMs = MAX_RATE_WAIT_MS } = {}) {
  const rl = result?.rateLimit;
  let waitS = null;
  if (rl?.remaining !== null && rl?.remaining !== undefined && rl.remaining < 1 && rl.reset !== null) waitS = rl.reset + 1;
  if (result?.status === 429 && rl?.retryAfter !== null && rl?.retryAfter !== undefined) waitS = Math.max(waitS ?? 0, rl.retryAfter + 1);
  if (waitS === null) return hostGapMs;
  return Math.max(hostGapMs, Math.min(waitS * 1000, maxRateWaitMs));
}

class FetchFailure extends Error {
  constructor(message, { status = null, retry = false, rateLimit = null } = {}) {
    super(message);
    this.status = status;
    this.retry = retry;
    this.rateLimit = rateLimit;
  }
}

// ---------------------------------------------------------------------------------------------
// Charset handling

const LATIN1_LABELS = new Set([
  'iso-8859-1', 'iso8859-1', 'iso_8859-1', 'latin1', 'latin-1', 'l1', 'cp819', 'ibm819', 'iso-ir-100',
  'windows-1252', 'cp1252', 'x-cp1252', 'us-ascii', 'ascii', 'ansi_x3.4-1968',
]);

/** Map a charset label to the decoder we use: "utf-8", "windows-1252", "utf-16le", "utf-16be" or another WHATWG label. */
export function normalizeCharset(label) {
  const l = String(label || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!l || l === 'utf8' || l === 'utf-8' || l === 'unicode-1-1-utf-8') return 'utf-8';
  if (LATIN1_LABELS.has(l)) return 'windows-1252';
  if (l === 'utf-16' || l === 'utf16') return 'utf-16le';
  return l;
}

/** Pick the charset: BOM first, then the Content-Type header, then the XML declaration, then UTF-8. */
export function detectCharset(bytes, contentType = '') {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const header = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
  if (header) return normalizeCharset(header[1]);
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  const decl = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']\s*([\w.:-]+)\s*["']/i.exec(head);
  if (decl) return normalizeCharset(decl[1]);
  return 'utf-8';
}

/** True when the bytes hold at least one well-formed multi-byte UTF-8 sequence (a lead byte and a continuation byte). */
function hasUtf8Sequence(bytes) {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] >= 0xc2 && bytes[i] <= 0xf4 && bytes[i + 1] >= 0x80 && bytes[i + 1] <= 0xbf) return true;
  }
  return false;
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a feed body to a string. Never throws; unknown charsets fall back to UTF-8. Returns { text, charset,
 * fallback }: fallback is true when a body labelled (or defaulted to) UTF-8 was read as windows-1252, because
 * it is not valid UTF-8 and holds no UTF-8 multi-byte sequence at all, so its high bytes can only be cp1252
 * ("Nintendo’s" sent as byte 0x92). A mostly valid UTF-8 body with one broken character stays UTF-8.
 */
export function decodeBody(bytes, contentType = '') {
  const buf = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes ?? '');
  let charset = detectCharset(buf, contentType);
  let text;
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (charset === 'utf-8' && !bom && buf.some((b) => b >= 0x80) && !isValidUtf8(buf) && !hasUtf8Sequence(buf)) {
    return { text: decodeWindows1252(buf).replace(/^\uFEFF/, ''), charset: 'windows-1252', fallback: true };
  }
  if (charset === 'windows-1252') {
    // Servers often label UTF-8 bodies as ISO-8859-1. Genuine cp1252 text with high bytes
    // is almost never valid UTF-8, so valid UTF-8 wins.
    if (buf.some((b) => b >= 0x80) && isValidUtf8(buf)) {
      charset = 'utf-8';
      text = new TextDecoder('utf-8').decode(buf);
    } else {
      text = decodeWindows1252(buf);
    }
  } else {
    try {
      text = new TextDecoder(charset).decode(buf);
    } catch {
      charset = 'utf-8';
      text = new TextDecoder('utf-8').decode(buf);
    }
  }
  return { text: text.replace(/^\uFEFF/, ''), charset, fallback: false };
}

// ---------------------------------------------------------------------------------------------
// Network

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new FetchFailure(`body over ${Math.round(maxBytes / 1048576)} MB`, { status: res.status });
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new FetchFailure(`body over ${Math.round(maxBytes / 1048576)} MB`, { status: res.status });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/** A short, log-friendly message for a thrown fetch error. */
export function describeError(err) {
  if (!err) return 'unknown error';
  if (err instanceof FetchFailure) return err.message;
  if (err.name === 'TimeoutError') return 'timeout';
  if (err.name === 'AbortError') return 'aborted';
  const cause = err.cause;
  const code = cause?.code || err.code;
  if (code) return String(code);
  const msg = String(cause?.message || err.message || err).split('\n')[0];
  return msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
}

/**
 * Build the request headers for a source.
 * @param {object} source feeds.json source entry
 * @param {{ userAgent?: string, etag?: string|null, lastModified?: string|null }} opts
 */
export function requestHeaders(source, { userAgent, etag, lastModified } = {}) {
  const ua = source.userAgent === 'browser' ? BROWSER_UA : source.userAgent || userAgent || BROWSER_UA;
  const headers = { 'User-Agent': ua, Accept: ACCEPT };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  return headers;
}

/**
 * Fetch one feed. Never throws: failures come back as { ok: false, error }.
 *
 * Result: { ok, notModified, status, text, bytes, charset, contentType, etag, lastModified, ms, error, attempts }
 */
export async function fetchFeed(source, opts = {}) {
  const {
    userAgent,
    etag = null,
    lastModified = null,
    timeoutMs = TIMEOUT_MS,
    maxBytes = MAX_BYTES,
    retryDelayMs = RETRY_DELAY_MS,
    fetchImpl = globalThis.fetch,
  } = opts;
  const headers = requestHeaders(source, { userAgent, etag, lastModified });
  let attempts = 0;
  let last = null;
  while (attempts < 2) {
    attempts++;
    const started = performance.now();
    try {
      const res = await fetchImpl(source.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const rateLimit = rateLimitOf(res.headers);
      if (res.status === 304) {
        await res.body?.cancel().catch(() => {});
        return {
          ok: true, notModified: true, status: 304, text: null, bytes: null, charset: null,
          contentType: res.headers.get('content-type'),
          etag: res.headers.get('etag') || etag, lastModified: res.headers.get('last-modified') || lastModified,
          ms: Math.round(performance.now() - started), error: null, attempts, rateLimit,
        };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new FetchFailure(`HTTP ${res.status}`, { status: res.status, retry: res.status >= 500, rateLimit });
      }
      const bytes = await readLimited(res, maxBytes);
      const contentType = res.headers.get('content-type') || '';
      const { text, charset, fallback } = decodeBody(bytes, contentType);
      return {
        ok: true, notModified: false, status: res.status, text, bytes, charset, charsetFallback: fallback, contentType,
        etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
        // After redirects: relative links in the feed resolve against where it really is.
        finalUrl: res.url || source.url,
        ms: Math.round(performance.now() - started), error: null, attempts, rateLimit,
      };
    } catch (err) {
      const isHttp = err instanceof FetchFailure;
      last = {
        ok: false, notModified: false, status: isHttp ? err.status : null, text: null, bytes: null, charset: null,
        contentType: null, etag, lastModified, ms: Math.round(performance.now() - started),
        error: describeError(err), attempts, rateLimit: isHttp ? err.rateLimit ?? null : null,
      };
      // Retry once on network errors and 5xx; never on 4xx, an oversized body or a redirect loop
      // (fetch gives up after 20 redirects; a second try would only send 21 more requests).
      const redirectLoop = /redirect/i.test(String(err?.cause?.message || err?.message || ''));
      const retry = isHttp ? err.retry : !redirectLoop;
      if (!retry || attempts >= 2) break;
      await sleep(retryDelayMs);
    }
  }
  return last;
}

/** Offline mode: read <fixturesDir>/<id>.xml. A missing fixture is a failed fetch. */
export async function readFixture(source, fixturesDir) {
  const file = path.join(fixturesDir, `${source.id}.xml`);
  try {
    const bytes = await readFile(file);
    const { text, charset, fallback } = decodeBody(bytes, '');
    // No network, so no response time: ms is null, which keeps offline builds reproducible.
    return {
      ok: true, notModified: false, status: 200, text, bytes, charset, charsetFallback: fallback, contentType: null, finalUrl: source.url,
      etag: null, lastModified: null, ms: null, error: null, attempts: 1,
    };
  } catch (err) {
    return {
      ok: false, notModified: false, status: null, text: null, bytes: null, charset: null, contentType: null,
      etag: null, lastModified: null, ms: null,
      error: err.code === 'ENOENT' ? 'fixture missing' : describeError(err), attempts: 1,
    };
  }
}

function hostKey(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

/**
 * Fetch every source. Different hosts run in parallel; sources on the same host run one after
 * another with a short gap, so Reddit's two feeds do not trip its rate limit. `rotate` (the build
 * passes the UTC hour) changes which same-host source goes first, so if a host only answers one
 * request per window, each of its sources still succeeds every other run and never goes "down".
 *
 * @param {object[]} sources feeds.json sources
 * @param {{ offline?: boolean, fixturesDir?: string, state?: object, userAgent?: string, rotate?: number,
 *           hostGapMs?: number, fetchImpl?: Function, timeoutMs?: number, retryDelayMs?: number }} opts
 * @returns {Promise<Map<string, object>>} id → fetch result
 */
export async function fetchAll(sources, opts = {}) {
  const { offline = false, fixturesDir, state = {}, hostGapMs = HOST_GAP_MS, maxRateWaitMs = MAX_RATE_WAIT_MS, rotate = 0, ...rest } = opts;
  const results = new Map();
  if (offline) {
    await Promise.all(sources.map(async (s) => results.set(s.id, await readFixture(s, fixturesDir))));
    return results;
  }
  const groups = new Map();
  for (const s of sources) {
    const key = hostKey(s.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const start = ((Math.trunc(rotate) % group.length) + group.length) % group.length;
      const ordered = [...group.slice(start), ...group.slice(0, start)];
      let previous = null;
      for (const s of ordered) {
        if (previous) await sleep(nextRequestDelay(previous, { hostGapMs, maxRateWaitMs }));
        const mem = state.sources?.[s.id] || {};
        previous = await fetchFeed(s, { ...rest, etag: mem.etag, lastModified: mem.lastModified });
        results.set(s.id, previous);
      }
    }),
  );
  return results;
}
