#!/usr/bin/env node
// Zero-dependency static server for local preview and screenshots.
//
//   node tools/serve.mjs [dir=site] [--port 8788] [--host 127.0.0.1] [--quiet]
//
// Mimics the parts of Cloudflare Workers Static Assets this site relies on (checked against wrangler dev
// 4.157.0, tests/serve.test.mjs):
//   - "/" and "/dir/" serve index.html; "/name" serves "name.html"; "/name.html" and "/index.html" answer
//     307 to "/name" and "/" (html_handling: "auto-trailing-slash"), so "/404.html" goes to "/404"
//   - unknown paths get <dir>/404.html with status 404 (not_found_handling: "404-page")
//   - <dir>/_redirects: static rules first, then dynamic ones in file order; "*" matches any text and
//     ":name" one path segment (both usable in the destination as :splat and :name); the incoming query
//     string is appended when the destination has none; status 200 serves the destination in place
//   - <dir>/_headers rules are applied by the request path to every response (404s and redirects too), values
//     from several matching rules joined with a comma, so the CSP is enforced locally
//   - assets get Cloudflare's default "Cache-Control: public, max-age=0, must-revalidate" and an ETag
//     (If-None-Match answers 304) unless a _headers rule sets Cache-Control
//   - _headers, _redirects and .assetsignore are never served
//   - paths match the files exactly, case included, as at the edge (macOS file systems ignore case), and JSON and
//     XML go out without a charset parameter, as wrangler dev sends them
// When imported: `const { url, close } = await startServer({ dir, port, host })`.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const HIDDEN = new Set(['_headers', '_redirects', '.assetsignore']);

function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), set: [], remove: [] };
      rules.push(current);
    } else if (current) {
      const line = raw.trim();
      if (line.startsWith('! ')) current.remove.push(line.slice(2).trim().toLowerCase());
      else {
        const i = line.indexOf(':');
        if (i > 0) current.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
      }
    }
  }
  return rules;
}

function parseRedirects(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [source, destination, code] = line.split(/\s+/);
    if (source && destination) rules.push({ source, destination, code: Number(code) || 302, dynamic: /[*:]/.test(source) });
  }
  // Cloudflare checks static rules before dynamic ones; within each kind the first match wins.
  return [...rules.filter((r) => !r.dynamic), ...rules.filter((r) => r.dynamic)];
}

const compiled = new Map();
/** Match a Cloudflare pattern: exact and case-sensitive, "*" = any text (:splat), ":name" = one path segment. */
function matches(pattern, pathname) {
  if (pattern === pathname) return { splat: '' };
  if (!/[*:]/.test(pattern)) return null;
  if (!compiled.has(pattern)) {
    const names = [];
    const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*|:(\w+)/g, (m, name) => {
      names.push(name || 'splat');
      return name ? '([^/]+)' : '(.*)';
    });
    compiled.set(pattern, { re: new RegExp(`^${source}$`), names });
  }
  const { re, names } = compiled.get(pattern);
  const m = re.exec(pathname);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
}

/** Replace :splat and :name placeholders in a destination. */
function fill(destination, params) {
  return destination.replace(/:(\w+)/g, (m, name) => (name in params ? params[name] : m));
}

export async function startServer({ dir = 'site', port = 8788, host = '127.0.0.1', quiet = true } = {}) {
  const root = path.resolve(dir);
  const read = (name) => (existsSync(path.join(root, name)) ? readFileSync(path.join(root, name), 'utf8') : '');
  const headerRules = () => parseHeaders(read('_headers'));
  const redirectRules = () => parseRedirects(read('_redirects'));

  /** True when every segment of `full` (under root) is spelled exactly as on disk: /STYLE.CSS is not /style.css. */
  async function spelledExactly(full) {
    let dir = root;
    for (const seg of path.relative(root, full).split(path.sep)) {
      try {
        if (!(await readdir(dir)).includes(seg)) return false;
      } catch {
        return false;
      }
      dir = path.join(dir, seg);
    }
    return true;
  }

  async function resolveFile(pathname) {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const candidates = [];
    if (rel === '' || rel.endsWith('/')) candidates.push(path.join(rel, 'index.html'));
    else candidates.push(rel, `${rel}.html`, path.join(rel, 'index.html'));
    for (const c of candidates) {
      const full = path.resolve(root, c);
      if (!full.startsWith(root + path.sep) && full !== root) continue; // no traversal
      try {
        const s = await stat(full);
        if (s.isFile() && (await spelledExactly(full)) && !HIDDEN.has(path.basename(full))) return full;
      } catch {}
    }
    return null;
  }

  function applyHeaders(res, pathname) {
    const set = new Map();
    for (const rule of headerRules()) {
      if (!matches(rule.pattern, pathname)) continue;
      for (const [k, v] of rule.set) set.set(k.toLowerCase(), [k, set.has(k.toLowerCase()) ? `${set.get(k.toLowerCase())[1]}, ${v}` : v]);
      for (const k of rule.remove) {
        set.delete(k);
        res.removeHeader(k);
      }
    }
    for (const [k, v] of set.values()) res.setHeader(k, v);
  }

  async function serveFile(req, res, file, status, pathname) {
    const body = await readFile(file);
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', etag);
    applyHeaders(res, pathname);
    if (status === 200 && req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      return res.end();
    }
    res.statusCode = status;
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function redirect(res, code, location, pathname) {
    res.statusCode = code;
    res.setHeader('Location', location);
    applyHeaders(res, pathname);
    res.end();
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || host}`);
    const pathname = url.pathname;
    try {
      for (const r of redirectRules()) {
        const m = matches(r.source, pathname);
        if (!m) continue;
        let dest = fill(r.destination, m);
        if (r.code === 200 && dest.startsWith('/')) {
          // A rewrite: the destination's file is served in place, with status 200.
          const target = await resolveFile(dest);
          if (target) {
            if (!quiet) console.log(`200 ${req.method} ${pathname}${url.search} (from ${dest})`);
            return serveFile(req, res, target, 200, pathname);
          }
          continue;
        }
        if (url.search && !dest.includes('?')) dest += url.search;
        if (!quiet) console.log(`${r.code} ${req.method} ${pathname}${url.search} -> ${dest}`);
        return redirect(res, r.code, dest, pathname);
      }
      // html_handling "auto-trailing-slash": /index.html -> /, /dir/index.html -> /dir/, /name.html -> /name.
      if (/\.html$/.test(pathname) && (await resolveFile(pathname))) {
        const clean = pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
        return redirect(res, 307, (clean || '/') + url.search, pathname);
      }
      let file = await resolveFile(pathname);
      let status = 200;
      if (!file) {
        file = await resolveFile('/404.html');
        status = 404;
      }
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      if (!quiet) console.log(`${status} ${req.method} ${pathname}${url.search}`);
      return serveFile(req, res, file, status, pathname);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err?.stack || err));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actual = server.address().port;
  return { url: `http://${host}:${actual}`, close: () => new Promise((r) => server.close(r)) };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--quiet')) || 'site';
  const { url } = await startServer({
    dir,
    port: Number(opt('--port', 8788)),
    host: opt('--host', '127.0.0.1'),
    quiet: args.includes('--quiet'),
  });
  console.log(`Serving ${path.resolve(dir)} at ${url}`);
}

